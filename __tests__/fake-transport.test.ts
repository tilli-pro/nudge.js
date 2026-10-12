import { afterEach, describe, expect, it, vi } from "vitest";
import { classifyResponse } from "../src/classify.js";
import { createNudgeClient } from "../src/client.js";
import { isNudgeError, NudgeError } from "../src/errors.js";
import { createFakeTransport } from "../src/fake-transport.js";
import { placeholderId } from "./helpers/fixtures.js";
import type { NudgeRequest, NudgeResponse } from "../src/classify.js";
import type { NudgeErrorCode } from "../src/errors.js";
import type {
  FakeNudgeTransport,
  FakeTemplate,
  FakeTransportOptions,
} from "../src/fake-transport.js";
import type { SendByTemplateInput } from "../src/send.js";

const API_KEY = "test-api-key";
const EMAIL = "recipient-1@example.com";
const PHONE = "+15550100001";
const NOT_FOUND = "Nudge not found for the given nudgeExternalRef and channel.";
const UNREADABLE = "fake transport: unreadable send body";

const TEMPLATES = [
  {
    externalRef: "welcome",
    channel: "email",
    mergeTags: ["firstName", "link"],
  },
  { externalRef: "welcome", channel: "sms", mergeTags: ["firstName"] },
  { externalRef: "receipt", channel: "email", mergeTags: [] },
] as const satisfies readonly FakeTemplate[];

const WELCOME_TAGS = { firstName: "Ada", link: "https://example.com/welcome" };
const WELCOME_EMAIL: SendByTemplateInput = {
  externalRef: "welcome",
  channel: "email",
  to: { email: EMAIL },
  mergeTags: WELCOME_TAGS,
};
const WELCOME_SMS: SendByTemplateInput = {
  externalRef: "welcome",
  channel: "sms",
  to: { phone: PHONE },
  mergeTags: { firstName: "Ada" },
};
const RECEIPT_EMAIL: SendByTemplateInput = {
  externalRef: "receipt",
  channel: "email",
  to: { email: EMAIL },
  mergeTags: {},
};
const WIRE_RECEIPT = {
  nudgeExternalRef: "receipt",
  channel: 0,
  toEmailAddress: EMAIL,
  mergeTags: [],
};

function setup(intercept?: FakeTransportOptions["intercept"]) {
  const fake = createFakeTransport({ templates: TEMPLATES, intercept });
  const client = createNudgeClient({ apiKey: API_KEY, transport: fake });
  return { fake, client };
}

function directSend(body?: unknown): NudgeRequest {
  return { operation: "send", method: "POST", path: "v2/Nudge/Send", body };
}

function construct(templates: readonly FakeTemplate[]): unknown {
  try {
    createFakeTransport({ templates });
  } catch (error) {
    return error;
  }
  return null;
}

function expectPlainError(thrown: unknown, message: string): void {
  expect(Object.getPrototypeOf(thrown)).toBe(Error.prototype);
  expect(isNudgeError(thrown)).toBe(false);
  expect(thrown).toHaveProperty("message", message);
}

async function failure(call: Promise<unknown>): Promise<NudgeError> {
  try {
    await call;
  } catch (error) {
    if (isNudgeError(error)) {
      return error;
    }
    throw error;
  }
  throw new Error("expected the call to reject");
}

function expectFailure(
  error: NudgeError,
  code: NudgeErrorCode,
  status: number | null,
  operation = "send",
): void {
  expect(isNudgeError(error)).toBe(true);
  expect(error.code).toBe(code);
  expect(error.operation).toBe(operation);
  expect(error.status).toBe(status);
}

function sentAt(fake: FakeNudgeTransport, index: number): SendByTemplateInput {
  const entry = fake.sent.at(index);
  if (entry === undefined) {
    throw new Error(`no accepted send at ${index}`);
  }
  return entry;
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("createFakeTransport", () => {
  describe("construction", () => {
    it("refuses a repeated ref and channel", () => {
      const repeated = construct([
        { externalRef: "welcome", channel: "email", mergeTags: [] },
        { externalRef: "receipt", channel: "email", mergeTags: [] },
        { externalRef: "welcome", channel: "email", mergeTags: ["other"] },
      ]);
      expectPlainError(
        repeated,
        "fake transport: duplicate template welcome/email",
      );

      const bothFaults = construct([
        { externalRef: "welcome", channel: "sms", mergeTags: [] },
        { externalRef: "welcome", channel: "sms", mergeTags: ["a", "a"] },
      ]);
      expectPlainError(
        bothFaults,
        "fake transport: duplicate template welcome/sms",
      );
    });

    it("refuses a tag listed twice", () => {
      const repeated = construct([
        {
          externalRef: "welcome",
          channel: "sms",
          mergeTags: ["a", "b", "b", "a"],
        },
        { externalRef: "welcome", channel: "sms", mergeTags: [] },
      ]);
      expectPlainError(
        repeated,
        "fake transport: template welcome/sms lists b twice",
      );

      const differentCase = construct([
        { externalRef: "welcome", channel: "sms", mergeTags: ["a", "A"] },
      ]);
      expect(differentCase).toBeNull();
    });

    it("accepts one ref on two channels", () => {
      expect(construct(TEMPLATES)).toBeNull();
      expect(
        construct([
          { externalRef: "welcome", channel: "email", mergeTags: ["a"] },
          { externalRef: "welcome", channel: "sms", mergeTags: ["a"] },
          { externalRef: "Welcome", channel: "sms", mergeTags: ["a"] },
        ]),
      ).toBeNull();
    });
  });

  describe("catalogue", () => {
    it("accepts a send that matches its template and records it", async () => {
      const { fake, client } = setup();

      const result = await client.sendByTemplate(WELCOME_EMAIL);
      expect(result).toEqual({
        accepted: true,
        notificationLogId: placeholderId(1),
      });

      const receipt = await client.sendByTemplate(RECEIPT_EMAIL);
      expect(receipt).toEqual({
        accepted: true,
        notificationLogId: placeholderId(2),
      });
      expect(fake.sent).toEqual([
        {
          externalRef: "welcome",
          channel: "email",
          to: { email: EMAIL },
          mergeTags: WELCOME_TAGS,
        },
        {
          externalRef: "receipt",
          channel: "email",
          to: { email: EMAIL },
          mergeTags: {},
        },
      ]);
    });

    it("answers not-found for an unknown ref", async () => {
      const { fake, client } = setup();

      const error = await failure(
        client.sendByTemplate({ ...WELCOME_EMAIL, externalRef: "missing" }),
      );
      expectFailure(error, "not-found", 400);
      expect(error.serverMessage).toBe(NOT_FOUND);
      expect(fake.sent).toEqual([]);

      const direct = await fake.request(
        directSend({ ...WIRE_RECEIPT, nudgeExternalRef: "missing" }),
      );
      expect(direct.status).toBe(400);
      expect(direct.body).toStrictEqual({
        HasErrors: true,
        Code: 400,
        Error: NOT_FOUND,
      });
    });

    it("answers not-found for a known ref on another channel", async () => {
      const { fake, client } = setup();

      const error = await failure(
        client.sendByTemplate({
          externalRef: "receipt",
          channel: "sms",
          to: { phone: PHONE },
          mergeTags: {},
        }),
      );
      expectFailure(error, "not-found", 400);
      expect(error.serverMessage).toBe(NOT_FOUND);
      expect(fake.sent).toEqual([]);
    });

    it("compares refs exactly", async () => {
      const { fake, client } = setup();

      const upper = await failure(
        client.sendByTemplate({ ...WELCOME_EMAIL, externalRef: "Welcome" }),
      );
      expectFailure(upper, "not-found", 400);

      const padded = await failure(
        client.sendByTemplate({ ...WELCOME_EMAIL, externalRef: "welcome " }),
      );
      expectFailure(padded, "not-found", 400);
      expect(fake.sent).toEqual([]);
    });

    it("answers invalid when a template tag is missing", async () => {
      const { fake, client } = setup();

      const error = await failure(
        client.sendByTemplate({
          ...WELCOME_EMAIL,
          mergeTags: { firstName: "Ada" },
        }),
      );
      expectFailure(error, "invalid", 400);
      expect(error.serverMessage).toBe(
        "fake transport: merge tags differ from welcome/email: missing link; unexpected none",
      );
      expect(fake.sent).toEqual([]);
    });

    it("answers invalid for an extra tag", async () => {
      const { fake, client } = setup();

      const error = await failure(
        client.sendByTemplate({
          ...WELCOME_EMAIL,
          mergeTags: { ...WELCOME_TAGS, promo: "10%" },
        }),
      );
      expectFailure(error, "invalid", 400);
      expect(error.serverMessage).toBe(
        "fake transport: merge tags differ from welcome/email: missing none; unexpected promo",
      );

      const extraOnEmpty = await failure(
        client.sendByTemplate({ ...RECEIPT_EMAIL, mergeTags: { total: "5" } }),
      );
      expect(extraOnEmpty.serverMessage).toBe(
        "fake transport: merge tags differ from receipt/email: missing none; unexpected total",
      );
      expect(fake.sent).toEqual([]);
    });

    it("lists both sides", async () => {
      const ordered = createFakeTransport({
        templates: [
          {
            externalRef: "order",
            channel: "email",
            mergeTags: ["zeta", "alpha", "mid"],
          },
        ],
      });
      const orderedClient = createNudgeClient({
        apiKey: API_KEY,
        transport: ordered,
      });
      const both = await failure(
        orderedClient.sendByTemplate({
          externalRef: "order",
          channel: "email",
          to: { email: EMAIL },
          mergeTags: { pear: "1", mid: "2", apple: "3" },
        }),
      );
      expectFailure(both, "invalid", 400);
      expect(both.serverMessage).toBe(
        "fake transport: merge tags differ from order/email: missing zeta, alpha; unexpected pear, apple",
      );

      const { client } = setup();
      const none = await failure(
        client.sendByTemplate({ ...WELCOME_EMAIL, mergeTags: {} }),
      );
      expect(none.serverMessage).toBe(
        "fake transport: merge tags differ from welcome/email: missing firstName, link; unexpected none",
      );

      const otherCase = await failure(
        client.sendByTemplate({
          ...WELCOME_EMAIL,
          mergeTags: { firstname: "Ada", link: "https://example.com/welcome" },
        }),
      );
      expect(otherCase.serverMessage).toBe(
        "fake transport: merge tags differ from welcome/email: missing firstName; unexpected firstname",
      );
    });
  });

  describe("sent", () => {
    it("holds the wire read-back, without a recipient name", async () => {
      const { fake, client } = setup();
      const to = { email: EMAIL, name: "Ada" };

      await client.sendByTemplate({ ...WELCOME_EMAIL, to });

      expect(sentAt(fake, 0).to).toStrictEqual({ email: EMAIL });
    });

    it("reads SMS sends back with the phone", async () => {
      const { fake, client } = setup();

      await client.sendByTemplate(WELCOME_SMS);

      expect(sentAt(fake, 0)).toStrictEqual({
        externalRef: "welcome",
        channel: "sms",
        to: { phone: PHONE },
        mergeTags: { firstName: "Ada" },
      });
    });

    it("reads recipientId from its own wire field", async () => {
      const { fake, client } = setup();

      await client.sendByTemplate({
        ...WELCOME_EMAIL,
        recipientId: "recipient-7",
      });

      const entry = sentAt(fake, 0);
      expect(entry.recipientId).toBe("recipient-7");
      expect(entry.mergeTags).toStrictEqual(WELCOME_TAGS);
    });

    it("adds no key for an absent optional field", async () => {
      const { fake, client } = setup();

      await client.sendByTemplate(WELCOME_EMAIL);
      await client.sendByTemplate({
        ...WELCOME_SMS,
        idempotencyKey: "key-1",
        recipientId: "recipient-7",
      });
      await client.sendByTemplate({
        ...RECEIPT_EMAIL,
        idempotencyKey: "key-2",
      });

      expect(Object.keys(sentAt(fake, 0))).toEqual([
        "externalRef",
        "channel",
        "to",
        "mergeTags",
      ]);
      expect(Object.keys(sentAt(fake, 1))).toEqual([
        "externalRef",
        "channel",
        "to",
        "mergeTags",
        "idempotencyKey",
        "recipientId",
      ]);
      expect(Object.keys(sentAt(fake, 2))).toEqual([
        "externalRef",
        "channel",
        "to",
        "mergeTags",
        "idempotencyKey",
      ]);
      expect(Object.keys(sentAt(fake, 0).to)).toEqual(["email"]);
    });

    it("keeps sends with different keys in order", async () => {
      const { fake, client } = setup();

      await client.sendByTemplate({
        ...WELCOME_SMS,
        idempotencyKey: "42:op-grace:sms",
      });
      await client.sendByTemplate({
        ...WELCOME_EMAIL,
        idempotencyKey: "42:op-grace:email",
      });

      expect(fake.sent.map((entry) => entry.idempotencyKey)).toEqual([
        "42:op-grace:sms",
        "42:op-grace:email",
      ]);
      expect(fake.sent.map((entry) => entry.channel)).toEqual(["sms", "email"]);
    });

    it("is the same array before and after sends", async () => {
      const { fake, client } = setup();
      const sentBefore = fake.sent;
      const requestsBefore = fake.requests;
      expect(sentBefore).toHaveLength(0);

      await client.sendByTemplate(WELCOME_EMAIL);

      expect(fake.sent).toBe(sentBefore);
      expect(fake.requests).toBe(requestsBefore);
      expect(sentBefore).toHaveLength(1);
      expect(requestsBefore).toHaveLength(1);
    });
  });

  describe("idempotency", () => {
    it("replays a repeated key with the first log id and records it once", async () => {
      const { fake, client } = setup();
      const input: SendByTemplateInput = {
        ...WELCOME_EMAIL,
        idempotencyKey: "key-1",
      };

      const first = await client.sendByTemplate(input);
      const second = await client.sendByTemplate(input);
      expect(first.notificationLogId).toBe(placeholderId(1));
      expect(second).toEqual(first);
      expect(fake.sent).toHaveLength(1);

      const otherRecipient = await client.sendByTemplate({
        ...input,
        to: { email: "recipient-2@example.com" },
      });
      expect(otherRecipient).toEqual(first);
      expect(fake.sent).toHaveLength(1);
      expect(sentAt(fake, 0).to).toStrictEqual({ email: EMAIL });

      const next = await client.sendByTemplate({
        ...input,
        idempotencyKey: "key-2",
      });
      expect(next.notificationLogId).toBe(placeholderId(2));
      expect(fake.sent).toHaveLength(2);

      const unknownRef = await failure(
        client.sendByTemplate({ ...input, externalRef: "missing" }),
      );
      expectFailure(unknownRef, "not-found", 400);

      const direct = createFakeTransport({ templates: TEMPLATES });
      const wire = { ...WIRE_RECEIPT, idempotencyKey: "key-1" };
      const firstWire = await direct.request(directSend(wire));
      const secondWire = await direct.request(directSend(wire));
      expect(secondWire.status).toBe(200);
      expect(secondWire.body).toStrictEqual(firstWire.body);
      expect(direct.sent).toHaveLength(1);
    });

    it("remembers only keys of accepted sends", async () => {
      const { fake, client } = setup();

      const unknownRef = await failure(
        client.sendByTemplate({
          ...WELCOME_EMAIL,
          externalRef: "missing",
          idempotencyKey: "key-1",
        }),
      );
      expectFailure(unknownRef, "not-found", 400);
      const wrongTags = await failure(
        client.sendByTemplate({
          ...WELCOME_EMAIL,
          mergeTags: {},
          idempotencyKey: "key-1",
        }),
      );
      expectFailure(wrongTags, "invalid", 400);
      expect(fake.sent).toEqual([]);

      const accepted = await client.sendByTemplate({
        ...WELCOME_EMAIL,
        idempotencyKey: "key-1",
      });
      expect(accepted.notificationLogId).toBe(placeholderId(1));
      expect(fake.sent).toHaveLength(1);
    });
  });

  describe("ids", () => {
    it("numbers log ids from 1 per fake", async () => {
      const first = setup();
      const second = setup();

      const a1 = await first.client.sendByTemplate(WELCOME_EMAIL);
      const a2 = await first.client.sendByTemplate(WELCOME_SMS);
      const b1 = await second.client.sendByTemplate(RECEIPT_EMAIL);

      expect(a1.notificationLogId).toBe(placeholderId(1));
      expect(a2.notificationLogId).toBe(placeholderId(2));
      expect(b1.notificationLogId).toBe(placeholderId(1));
      expect(a1.notificationLogId).toBe("00000000-0000-4000-8000-000000000001");
    });

    it("answers Nudge's flattened success body", async () => {
      const fake = createFakeTransport({ templates: TEMPLATES });

      const response = await fake.request(directSend(WIRE_RECEIPT));

      expect(response.status).toBe(200);
      expect(response.headers).toBeInstanceOf(Headers);
      expect(response.body).toStrictEqual({
        HasErrors: false,
        Code: 200,
        NotificationLogId: placeholderId(1),
        Errors: null,
        Statuses: {},
      });
      expect(classifyResponse("send", response)).toBeNull();
    });
  });

  describe("other requests", () => {
    it("records every request, intercepted or not", async () => {
      const seen: string[] = [];
      const { fake, client } = setup((request) => {
        seen.push(request.operation);
        return request.operation === "lists.list"
          ? { status: 200, headers: new Headers(), body: { data: [] } }
          : undefined;
      });
      const listRequest: NudgeRequest = {
        operation: "lists.list",
        method: "GET",
        path: "v1/Lists",
      };

      const listed = await fake.request(listRequest);
      await client.sendByTemplate(WELCOME_EMAIL);

      expect(listed.status).toBe(200);
      expect(listed.body).toStrictEqual({ data: [] });
      expect(seen).toEqual(["lists.list", "send"]);
      expect(fake.requests).toHaveLength(2);
      expect(fake.requests.at(0)).toBe(listRequest);
      expect(fake.requests.at(1)).toMatchObject({
        operation: "send",
        method: "POST",
        path: "v2/Nudge/Send",
      });
      expect(fake.sent).toHaveLength(1);
    });

    it("returns an intercepted response through the client's classification", async () => {
      const answers: NudgeResponse[] = [
        { status: 429, headers: new Headers(), body: null },
        { status: 500, headers: new Headers(), body: null },
      ];
      const { fake, client } = setup(() => answers.shift());

      const limited = await failure(client.sendByTemplate(WELCOME_EMAIL));
      expectFailure(limited, "rate-limited", 429);
      expect(limited.retryable).toBe(true);
      expect(limited.retryAfterSeconds).toBeNull();

      const broken = await failure(client.sendByTemplate(WELCOME_EMAIL));
      expectFailure(broken, "server", 500);
      expect(broken.retryable).toBe(true);

      const accepted = await client.sendByTemplate(WELCOME_EMAIL);
      expect(accepted.notificationLogId).toBe(placeholderId(1));
      expect(fake.sent).toHaveLength(1);
      expect(fake.requests).toHaveLength(3);
    });

    it("falls through when intercept returns undefined", async () => {
      const intercept = vi.fn<NonNullable<FakeTransportOptions["intercept"]>>(
        () => undefined,
      );
      const { fake, client } = setup(intercept);

      const result = await client.sendByTemplate(WELCOME_EMAIL);

      expect(result.notificationLogId).toBe(placeholderId(1));
      expect(intercept).toHaveBeenCalledTimes(1);
      expect(intercept.mock.calls.at(0)?.[0]).toBe(fake.requests.at(0));
      expect(fake.sent).toHaveLength(1);
    });

    it("turns a throw from intercept into network", async () => {
      const boom = new Error("socket hang up");
      const { fake, client } = setup(() => {
        throw boom;
      });

      const error = await failure(client.sendByTemplate(WELCOME_EMAIL));

      expectFailure(error, "network", null);
      expect(error.cause).toBe(boom);
      expect(error.retryable).toBe(true);
      expect(fake.requests).toHaveLength(1);
      expect(fake.sent).toEqual([]);
    });

    it("answers invalid for an operation with no scripted response", async () => {
      const { fake, client } = setup();

      const error = await failure(
        client.stats.list({ channel: "email", timeZone: "UTC" }),
      );

      expectFailure(error, "invalid", 400, "stats.list");
      expect(error.serverMessage).toBe(
        "fake transport: no response scripted for stats.list",
      );
      expect(fake.requests).toHaveLength(1);
      expect(fake.sent).toEqual([]);
    });

    it("answers 400 for an unreadable send body", async () => {
      const fake = createFakeTransport({ templates: TEMPLATES });

      const response = await fake.request(directSend({}));

      expect(response.status).toBe(400);
      expect(response.headers).toBeInstanceOf(Headers);
      expect(response.body).toStrictEqual({
        HasErrors: true,
        Code: 400,
        Error: UNREADABLE,
      });
      expect(fake.sent).toEqual([]);
      expect(fake.requests).toHaveLength(1);
    });
  });

  describe("unreadable send bodies", () => {
    const CASES: readonly (readonly [string, unknown])[] = [
      ["no body", undefined],
      ["a null body", null],
      ["a text body", "not json"],
      ["a list body", []],
      ["a channel given by name", { ...WIRE_RECEIPT, channel: "email" }],
      ["an unknown channel code", { ...WIRE_RECEIPT, channel: 2 }],
      ["a missing ref", { channel: 0, toEmailAddress: EMAIL, mergeTags: [] }],
      ["a numeric ref", { ...WIRE_RECEIPT, nudgeExternalRef: 7 }],
      [
        "an e-mail send with only a phone",
        { ...WIRE_RECEIPT, toEmailAddress: undefined, toPhoneNumber: PHONE },
      ],
      ["an SMS send with only an e-mail", { ...WIRE_RECEIPT, channel: 1 }],
      ["a numeric address", { ...WIRE_RECEIPT, toEmailAddress: 5 }],
      [
        "merge tags that are not a list",
        { ...WIRE_RECEIPT, mergeTags: { firstName: "Ada" } },
      ],
      [
        "a merge tag without a value",
        { ...WIRE_RECEIPT, mergeTags: [{ tagName: "firstName" }] },
      ],
      ["a numeric idempotency key", { ...WIRE_RECEIPT, idempotencyKey: 5 }],
      ["a numeric recipient id", { ...WIRE_RECEIPT, recipientId: 5 }],
    ];

    it.each(CASES)("answers 400 for %s", async (_label, body) => {
      const fake = createFakeTransport({ templates: TEMPLATES });

      const response = await fake.request(directSend(body));

      expect(response.status).toBe(400);
      expect(response.body).toStrictEqual({
        HasErrors: true,
        Code: 400,
        Error: UNREADABLE,
      });
      expect(fake.sent).toEqual([]);
    });

    it("reads a null optional field as absent", async () => {
      const fake = createFakeTransport({ templates: TEMPLATES });

      const response = await fake.request(
        directSend({
          ...WIRE_RECEIPT,
          idempotencyKey: null,
          recipientId: null,
        }),
      );

      expect(response.status).toBe(200);
      expect(Object.keys(sentAt(fake, 0))).toEqual([
        "externalRef",
        "channel",
        "to",
        "mergeTags",
      ]);
    });
  });

  describe("consumer pins", () => {
    it("rejects with NudgeError instances", async () => {
      const { client } = setup();

      const notFound = await client
        .sendByTemplate({ ...WELCOME_EMAIL, externalRef: "missing" })
        .catch((error: unknown) => error);
      const invalid = await client
        .sendByTemplate({ ...WELCOME_EMAIL, mergeTags: {} })
        .catch((error: unknown) => error);

      expect(notFound).toBeInstanceOf(NudgeError);
      expect(invalid).toBeInstanceOf(NudgeError);
      expect(notFound).toMatchObject({ code: "not-found", status: 400 });
      expect(invalid).toMatchObject({ code: "invalid", status: 400 });
    });

    it("needs no timer", async () => {
      vi.useFakeTimers();
      const { client } = setup();

      const result = await client.sendByTemplate(WELCOME_EMAIL);

      expect(result).toEqual({
        accepted: true,
        notificationLogId: placeholderId(1),
      });
      expect(vi.getTimerCount()).toBe(0);
    });
  });
});
