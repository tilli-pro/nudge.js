import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { createHttpTransport } from "../src/http-transport.js";
import {
  preferenceLookupRequest,
  preferenceUpdateRequest,
} from "../src/preferences.js";
import { readSendResult, sendRequest } from "../src/send.js";
import { statsDetailsRequest, statsListRequest } from "../src/stats.js";
import type {
  NudgeRequestSpec,
  NudgeResponse,
  NudgeTransport,
} from "../src/classify.js";

export interface ScrubContext {
  readonly apiKey: string;
  readonly ref: string;
  readonly preference: string;
  readonly email: string;
  readonly phone: string;
}

const GUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PHONE_SCRUB = /(?<![\dA-Za-z-])\+?\d{7,15}(?![\dA-Za-z-])/g;
const PHONE_GUARD = /(?<![\dA-Za-z])\+?\d{10,15}(?![\dA-Za-z])/g;
const PLACEHOLDER_GUID = /^00000000-0000-4000-8000-\d{12}$/;
const NON_DIGITS = /\D/g;
const PAUSE_MS = 400;
const REQUEST_TIMEOUT_MS = 30_000;
const DERIVED_CATEGORIES: readonly string[] = [
  "Fixture category",
  "fixture-unknown-category",
];
const VARIABLES = [
  "NUDGE_API_KEY",
  "NUDGE_BASE_URL",
  "NUDGE_FIXTURE_EMAIL",
  "NUDGE_FIXTURE_PHONE",
  "NUDGE_FIXTURE_REF",
  "NUDGE_FIXTURE_PREFERENCE",
] as const;

interface Counters {
  readonly guids: Map<string, number>;
  readonly emails: Map<string, number>;
  readonly phones: Map<string, number>;
  readonly categories: Map<string, number>;
}

interface RecorderEnv {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly email: string;
  readonly phone: string;
  readonly ref: string;
  readonly preference: string;
}

interface Exchange {
  readonly request: {
    readonly method: string;
    readonly path: string;
    readonly query?: Readonly<Record<string, string>>;
    readonly body?: unknown;
  };
  readonly response: {
    readonly status: number;
    readonly headers: Readonly<Record<string, string>>;
    readonly body: unknown;
  };
}

interface Planned {
  readonly name: string;
  readonly key: "main" | "invalid";
  build(recorded: ReadonlyMap<string, Exchange>): NudgeRequestSpec;
}

export function placeholderId(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

function ordinal(seen: Map<string, number>, key: string): number {
  const known = seen.get(key);
  if (known !== undefined) {
    return known;
  }
  const next = seen.size + 1;
  seen.set(key, next);
  return next;
}

function rewrite(
  text: string,
  context: ScrubContext,
  counters: Counters,
): string {
  let result = text;
  if (context.apiKey !== "") {
    result = result.replaceAll(context.apiKey, "<api-key>");
  }
  if (context.ref !== "") {
    result = result.replaceAll(context.ref, "fixture-ref");
  }
  if (context.preference !== "") {
    result = result.replaceAll(context.preference, "Fixture category");
  }
  return result
    .replace(GUID, (match) =>
      placeholderId(ordinal(counters.guids, match.toLowerCase())),
    )
    .replace(
      EMAIL,
      (match) =>
        `recipient-${ordinal(counters.emails, match.toLowerCase())}@example.com`,
    )
    .replace(PHONE_SCRUB, (match) => {
      const n = ordinal(counters.phones, match.replace(NON_DIGITS, ""));
      const digits = `1555010${String(n).padStart(4, "0")}`;
      return match.startsWith("+") ? `+${digits}` : digits;
    });
}

function walk(
  value: unknown,
  context: ScrubContext,
  counters: Counters,
): unknown {
  if (typeof value === "string") {
    return rewrite(value, context, counters);
  }
  if (Array.isArray(value)) {
    return value.map((item: unknown) => walk(item, context, counters));
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  const entries: [string, unknown][] = [];
  for (const [rawKey, rawValue] of Object.entries(value)) {
    const key = rewrite(rawKey, context, counters);
    const lower = key.toLowerCase();
    if (lower === "accountid") {
      entries.push([key, 0]);
      continue;
    }
    const walked = walk(rawValue, context, counters);
    if (
      lower === "preferencetype" &&
      typeof walked === "string" &&
      !DERIVED_CATEGORIES.includes(walked)
    ) {
      entries.push([
        key,
        `Other category ${ordinal(counters.categories, walked)}`,
      ]);
      continue;
    }
    entries.push([key, walked]);
  }
  return Object.fromEntries(entries);
}

export function scrubFixture(value: unknown, context: ScrubContext): unknown {
  const counters: Counters = {
    guids: new Map(),
    emails: new Map(),
    phones: new Map(),
    categories: new Map(),
  };
  return walk(value, context, counters);
}

export function assertScrubbed(text: string, context: ScrubContext): void {
  const lower = text.toLowerCase();
  const phoneDigits = context.phone.replace(NON_DIGITS, "");
  const withoutGuids = text.replace(GUID, " ");
  const checks: readonly (readonly [string, boolean])[] = [
    ["the api key", context.apiKey !== "" && text.includes(context.apiKey)],
    [
      "the fixture address",
      context.email !== "" && lower.includes(context.email.toLowerCase()),
    ],
    [
      "the fixture number",
      context.phone !== "" &&
        (text.includes(context.phone) ||
          (phoneDigits !== "" && text.includes(phoneDigits))),
    ],
    [
      "a GUID",
      (text.match(GUID) ?? []).some((match) => !PLACEHOLDER_GUID.test(match)),
    ],
    [
      "an address",
      (text.match(EMAIL) ?? []).some(
        (match) => !match.endsWith("@example.com"),
      ),
    ],
    [
      "a number",
      (withoutGuids.match(PHONE_GUARD) ?? []).some(
        (match) => !(match.startsWith("+1555") || match.startsWith("1555")),
      ),
    ],
  ];
  for (const [what, survived] of checks) {
    if (survived) {
      throw new Error(`record-fixtures: ${what} survived scrubbing`);
    }
  }
}

function readEnv(env: NodeJS.ProcessEnv): RecorderEnv {
  const missing = VARIABLES.filter((name) => (env[name] ?? "") === "");
  if (missing.length > 0) {
    throw new Error(`record-fixtures: set ${missing.join(", ")}`);
  }
  const read = (name: (typeof VARIABLES)[number]): string => env[name] ?? "";
  return {
    apiKey: read("NUDGE_API_KEY"),
    baseUrl: read("NUDGE_BASE_URL"),
    email: read("NUDGE_FIXTURE_EMAIL"),
    phone: read("NUDGE_FIXTURE_PHONE"),
    ref: read("NUDGE_FIXTURE_REF"),
    preference: read("NUDGE_FIXTURE_PREFERENCE"),
  };
}

function plan(env: RecorderEnv, today: string): readonly Planned[] {
  const k1 = randomUUID();
  const k2 = randomUUID();
  const unknownId = randomUUID();
  const mergeTags = { fixtureTag: "fixture value" };
  const send = (
    over: Partial<Parameters<typeof sendRequest>[0]> = {},
  ): NudgeRequestSpec =>
    sendRequest({
      externalRef: env.ref,
      channel: "email",
      to: { email: env.email },
      mergeTags,
      ...over,
    });
  const raw = (body: unknown): NudgeRequestSpec => ({
    operation: "send",
    method: "POST",
    path: "v2/Nudge/Send",
    body,
  });
  const sms = (to: string, idempotencyKey?: string): NudgeRequestSpec =>
    sendRequest({
      externalRef: env.ref,
      channel: "sms",
      to: { phone: to },
      mergeTags,
      ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
    });
  const accepted = (recorded: ReadonlyMap<string, Exchange>): string => {
    const id = readSendResult(
      recorded.get("send.accepted")?.response.body,
    ).notificationLogId;
    if (id === null) {
      throw new Error("record-fixtures: send.accepted returned no log id");
    }
    return id;
  };
  const update = (preferenceType: string): NudgeRequestSpec =>
    preferenceUpdateRequest({
      recipientId: "fixture-recipient",
      email: env.email,
      changes: [{ preferenceType, email: true }],
    });
  const lookup = { recipientId: "fixture-recipient" };
  const fixed = (name: string, spec: NudgeRequestSpec): Planned => ({
    name,
    key: "main",
    build: () => spec,
  });
  return [
    fixed("send.accepted", send({ idempotencyKey: k1 })),
    fixed("send.replay", send({ idempotencyKey: k1 })),
    fixed("send.unknown-ref", send({ externalRef: `${env.ref}-unknown` })),
    fixed("send.missing-merge-tag", send({ mergeTags: {} })),
    fixed(
      "send.duplicate-tag",
      raw({
        nudgeExternalRef: env.ref,
        channel: 0,
        toEmailAddress: env.email,
        mergeTags: [
          { tagName: "fixtureTag", tagValue: "fixture value" },
          { tagName: "FIXTURETAG", tagValue: "fixture value" },
        ],
      }),
    ),
    fixed(
      "send.link-tag-refused",
      send({
        mergeTags: {
          fixtureTag: "fixture value",
          Unsubscribe: "https://example.com/unsubscribe",
        },
      }),
    ),
    { ...fixed("send.unauthorized-key", send({})), key: "invalid" },
    fixed(
      "send.problem-details",
      raw({
        nudgeExternalRef: env.ref,
        channel: "email",
        toEmailAddress: env.email,
        mergeTags: [],
      }),
    ),
    fixed("send.sms-accepted", sms(env.phone, k2)),
    fixed("send.sms-number-refused", sms("+1555")),
    fixed(
      "stats.list.window",
      statsListRequest({
        channel: "email",
        timeZone: "UTC",
        email: env.email,
        from: `${today}T00:00:00`,
        to: `${today}T00:00:00`,
        top: 10,
      }),
    ),
    {
      name: "stats.details.merge-tags",
      key: "main",
      build: (recorded) =>
        statsDetailsRequest({
          channel: "email",
          notificationLogId: accepted(recorded),
        }),
    },
    fixed(
      "stats.details.unknown-id",
      statsDetailsRequest({ channel: "email", notificationLogId: unknownId }),
    ),
    fixed("preferences.update.accepted", update(env.preference)),
    fixed(
      "preferences.get.found",
      preferenceLookupRequest("preferences.get", lookup),
    ),
    fixed(
      "preferences.history.found",
      preferenceLookupRequest("preferences.history", lookup),
    ),
    fixed("preferences.update.refused", update("fixture-unknown-category")),
  ];
}

function toExchange(
  request: NudgeRequestSpec,
  response: NudgeResponse,
): Exchange {
  const headers: Record<string, string> = {};
  const contentType = response.headers.get("content-type");
  if (contentType !== null) {
    headers["content-type"] = contentType;
  }
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter !== null) {
    headers["retry-after"] = retryAfter;
  }
  return {
    request: {
      method: request.method,
      path: request.path,
      ...(request.query === undefined ? {} : { query: request.query }),
      ...(request.body === undefined ? {} : { body: request.body }),
    },
    response: { status: response.status, headers, body: response.body },
  };
}

async function recordAll(
  env: RecorderEnv,
  today: string,
): Promise<ReadonlyMap<string, Exchange>> {
  const transports: Record<Planned["key"], NudgeTransport> = {
    main: createHttpTransport({ apiKey: env.apiKey, baseUrl: env.baseUrl }),
    invalid: createHttpTransport({
      apiKey: "invalid-key",
      baseUrl: env.baseUrl,
    }),
  };
  const recorded = new Map<string, Exchange>();
  for (const planned of plan(env, today)) {
    if (recorded.size > 0) {
      // biome-ignore lint/performance/noAwaitInLoops: one request at a time, paced, because Nudge limits send per account
      await sleep(PAUSE_MS);
    }
    const spec = planned.build(recorded);
    let response: NudgeResponse;
    try {
      response = await transports[planned.key].request({
        ...spec,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new Error(`record-fixtures: ${planned.name} got no response`);
    }
    if (response.status === 429 || response.status >= 500) {
      throw new Error(
        `record-fixtures: ${planned.name} answered HTTP ${response.status}; nothing was written`,
      );
    }
    recorded.set(planned.name, toExchange(spec, response));
  }
  return recorded;
}

async function main(): Promise<void> {
  const env = readEnv(process.env);
  const today = new Date().toISOString().slice(0, 10);
  const recorded = await recordAll(env, today);
  const context: ScrubContext = {
    apiKey: env.apiKey,
    ref: env.ref,
    preference: env.preference,
    email: env.email,
    phone: env.phone,
  };
  const files: { name: string; text: string; status: number }[] = [];
  for (const [name, exchange] of recorded) {
    const { request, response } = scrubFixture(
      { request: exchange.request, response: exchange.response },
      context,
    ) as Exchange;
    const text = `${JSON.stringify(
      {
        origin: "recorded",
        source: `pnpm record-fixtures, ${today}`,
        request,
        response,
      },
      null,
      2,
    )}\n`;
    assertScrubbed(text, context);
    files.push({ name, text, status: exchange.response.status });
  }
  for (const file of files) {
    writeFileSync(
      resolve(import.meta.dirname, "..", "fixtures", `${file.name}.json`),
      file.text,
    );
  }
  for (const file of files) {
    process.stdout.write(`recorded ${file.name} (HTTP ${file.status})\n`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : "unknown error"}\n`,
    );
    process.exitCode = 1;
  });
}
