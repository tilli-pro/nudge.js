import { readField } from "./classify.js";
import { channelFromCode, fromWireTags } from "./wire.js";
import type {
  NudgeRequest,
  NudgeResponse,
  NudgeTransport,
} from "./classify.js";
import type { SendByTemplateInput } from "./send.js";
import type { NudgeChannel } from "./wire.js";

export interface FakeTemplate {
  readonly externalRef: string;
  readonly channel: NudgeChannel;
  readonly mergeTags: readonly string[];
}

export interface FakeTransportOptions {
  readonly templates: readonly FakeTemplate[];
  readonly intercept?: (request: NudgeRequest) => NudgeResponse | undefined;
}

export interface FakeNudgeTransport extends NudgeTransport {
  readonly sent: readonly SendByTemplateInput[];
  readonly requests: readonly NudgeRequest[];
}

const NOT_FOUND = "Nudge not found for the given nudgeExternalRef and channel.";
const UNREADABLE = "fake transport: unreadable send body";
const LOG_ID_PREFIX = "00000000-0000-4000-8000-";
const LOG_ID_DIGITS = 12;

function assertTemplates(templates: readonly FakeTemplate[]): void {
  for (const [index, template] of templates.entries()) {
    const { externalRef, channel } = template;
    const repeated = templates
      .slice(0, index)
      .some(
        (earlier) =>
          earlier.externalRef === externalRef && earlier.channel === channel,
      );
    if (repeated) {
      throw new Error(
        `fake transport: duplicate template ${externalRef}/${channel}`,
      );
    }
    for (const [tagIndex, tag] of template.mergeTags.entries()) {
      if (template.mergeTags.slice(0, tagIndex).includes(tag)) {
        throw new Error(
          `fake transport: template ${externalRef}/${channel} lists ${tag} twice`,
        );
      }
    }
  }
}

function refused(text: string): NudgeResponse {
  return {
    status: 400,
    headers: new Headers(),
    body: { HasErrors: true, Code: 400, Error: text },
  };
}

function accepted(notificationLogId: string): NudgeResponse {
  return {
    status: 200,
    headers: new Headers(),
    body: {
      HasErrors: false,
      Code: 200,
      NotificationLogId: notificationLogId,
      Errors: null,
      Statuses: {},
    },
  };
}

/** Reads an optional string field: null or missing is absent, a non-string is a fault. */
function readOptionalString(
  body: unknown,
  name: string,
): { readonly value: string | undefined } | undefined {
  const field = readField(body, name);
  if (field === undefined || field === null) {
    return { value: undefined };
  }
  return typeof field === "string" ? { value: field } : undefined;
}

function readSendBody(body: unknown): SendByTemplateInput | undefined {
  const externalRef = readField(body, "nudgeExternalRef");
  const channel = channelFromCode(readField(body, "channel"));
  if (typeof externalRef !== "string" || channel === undefined) {
    return;
  }
  const address = readField(
    body,
    channel === "email" ? "toEmailAddress" : "toPhoneNumber",
  );
  const mergeTags = fromWireTags(readField(body, "mergeTags"));
  const idempotencyKey = readOptionalString(body, "idempotencyKey");
  const recipientId = readOptionalString(body, "recipientId");
  if (
    typeof address !== "string" ||
    mergeTags === undefined ||
    idempotencyKey === undefined ||
    recipientId === undefined
  ) {
    return;
  }
  return {
    externalRef,
    channel,
    to: channel === "email" ? { email: address } : { phone: address },
    mergeTags,
    ...(idempotencyKey.value === undefined
      ? {}
      : { idempotencyKey: idempotencyKey.value }),
    ...(recipientId.value === undefined
      ? {}
      : { recipientId: recipientId.value }),
  };
}

function describeTags(names: readonly string[]): string {
  return names.length === 0 ? "none" : names.join(", ");
}

export function createFakeTransport(
  options: FakeTransportOptions,
): FakeNudgeTransport {
  assertTemplates(options.templates);
  const sent: SendByTemplateInput[] = [];
  const requests: NudgeRequest[] = [];
  const remembered = new Map<string, string>();
  let counter = 0;

  async function request(call: NudgeRequest): Promise<NudgeResponse> {
    requests.push(call);
    if (options.intercept !== undefined) {
      const scripted = options.intercept(call);
      if (scripted !== undefined) {
        return scripted;
      }
    }
    if (call.operation !== "send") {
      return refused(
        `fake transport: no response scripted for ${call.operation}`,
      );
    }
    const input = readSendBody(call.body);
    if (input === undefined) {
      return refused(UNREADABLE);
    }
    const template = options.templates.find(
      (candidate) =>
        candidate.externalRef === input.externalRef &&
        candidate.channel === input.channel,
    );
    if (template === undefined) {
      return refused(NOT_FOUND);
    }
    const names = Object.keys(input.mergeTags);
    const missing = template.mergeTags.filter((tag) => !names.includes(tag));
    const unexpected = names.filter(
      (name) => !template.mergeTags.includes(name),
    );
    if (missing.length > 0 || unexpected.length > 0) {
      return refused(
        `fake transport: merge tags differ from ${input.externalRef}/${input.channel}: missing ${describeTags(missing)}; unexpected ${describeTags(unexpected)}`,
      );
    }
    const replayed =
      input.idempotencyKey === undefined
        ? undefined
        : remembered.get(input.idempotencyKey);
    if (replayed !== undefined) {
      return accepted(replayed);
    }
    counter += 1;
    const id = `${LOG_ID_PREFIX}${String(counter).padStart(LOG_ID_DIGITS, "0")}`;
    sent.push(input);
    if (input.idempotencyKey !== undefined) {
      remembered.set(input.idempotencyKey, id);
    }
    return accepted(id);
  }

  return { sent, requests, request };
}
