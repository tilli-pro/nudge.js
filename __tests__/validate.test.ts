import { describe, expect, it, vi } from "vitest";
import { isNudgeError } from "../src/errors.js";
import {
  type ClientOptionFields,
  validateClientOptions,
  validatePreferenceLookup,
  validatePreferenceUpdate,
  validateSendInput,
  validateStatsDetails,
  validateStatsQuery,
} from "../src/validate.js";
import { placeholderId } from "./helpers/fixtures.js";
import type { PreferenceLookupOperation } from "../src/preferences.js";
import type { SendByTemplateInput } from "../src/send.js";
import type { StatsQuery } from "../src/stats.js";

const API_KEY = "test-api-key";
const BASE_URL = "https://nudge.example.com/api";
const EMAIL = "recipient-1@example.com";
const PHONE = "+15550100001";
const REF = "fixture-ref";

function expectInvalid(run: () => void, operation: string): void {
  let caught: unknown;
  try {
    run();
  } catch (error) {
    caught = error;
  }
  expect(isNudgeError(caught)).toBe(true);
  expect(caught).toMatchObject({
    code: "invalid",
    operation,
    status: null,
    retryable: false,
  });
}

function cast<T>(value: unknown): T {
  return value as T;
}

describe("client options", () => {
  it("accepts the minimal options", () => {
    expect(() => validateClientOptions({ apiKey: API_KEY })).not.toThrow();
  });

  it("accepts a fetch or a transport alone", () => {
    const full = { apiKey: API_KEY, baseUrl: BASE_URL, timeoutMs: 250 };
    expect(() =>
      validateClientOptions({ ...full, fetch: vi.fn() }),
    ).not.toThrow();
    expect(() =>
      validateClientOptions({ ...full, transport: { request: vi.fn() } }),
    ).not.toThrow();
    expect(() =>
      validateClientOptions({
        apiKey: API_KEY,
        baseUrl: "http://localhost:8080/api",
      }),
    ).not.toThrow();
  });

  const invalid: [string, unknown][] = [
    ["an empty apiKey", { apiKey: "" }],
    ["a blank apiKey", { apiKey: "   " }],
    ["a numeric apiKey", { apiKey: 5 }],
    ["a relative baseUrl", { apiKey: API_KEY, baseUrl: "/api" }],
    [
      "an ftp baseUrl",
      { apiKey: API_KEY, baseUrl: "ftp://nudge.example.com/api" },
    ],
    ["a timeoutMs of 0", { apiKey: API_KEY, timeoutMs: 0 }],
    ["a negative timeoutMs", { apiKey: API_KEY, timeoutMs: -1 }],
    ["a fractional timeoutMs", { apiKey: API_KEY, timeoutMs: 1.5 }],
    ["a NaN timeoutMs", { apiKey: API_KEY, timeoutMs: Number.NaN }],
    ["a string timeoutMs", { apiKey: API_KEY, timeoutMs: "100" }],
    [
      "fetch together with transport",
      { apiKey: API_KEY, fetch: vi.fn(), transport: { request: vi.fn() } },
    ],
    ["null options", null],
  ];
  it.each(invalid)("rejects %s", (_label, options) => {
    expectInvalid(
      () => validateClientOptions(cast<ClientOptionFields>(options)),
      "createNudgeClient",
    );
  });
});

describe("send", () => {
  const email: SendByTemplateInput = {
    externalRef: REF,
    channel: "email",
    to: { email: EMAIL },
    mergeTags: { fixtureTag: "fixture value" },
  };
  const sms: SendByTemplateInput = {
    ...email,
    channel: "sms",
    to: { phone: PHONE },
  };

  it("accepts a valid e-mail and SMS send", () => {
    expect(() => validateSendInput(email)).not.toThrow();
    expect(() => validateSendInput(sms)).not.toThrow();
    expect(() => validateSendInput({ ...email, mergeTags: {} })).not.toThrow();
  });

  it("accepts an empty tag value, a 200-character key and extra properties on to", () => {
    const to = { email: EMAIL, phone: PHONE, name: "Fixture Name" };
    const accepted = {
      ...email,
      to,
      mergeTags: { fixtureTag: "" },
      idempotencyKey: "k".repeat(200),
    };
    expect(() =>
      validateSendInput({ ...accepted, recipientId: "fixture-recipient" }),
    ).not.toThrow();
  });

  const invalid: [string, unknown][] = [
    ["a blank externalRef", { ...email, externalRef: "   " }],
    ["an empty externalRef", { ...email, externalRef: "" }],
    ["a non-string externalRef", { ...email, externalRef: 5 }],
    ["an unknown channel", { ...email, channel: "whatsapp" }],
    ["an e-mail send with only a phone", { ...email, to: { phone: PHONE } }],
    ["an SMS send with only an e-mail", { ...sms, to: { email: EMAIL } }],
    ["a blank address", { ...email, to: { email: "  " } }],
    [
      "a comma in the address",
      { ...email, to: { email: "a@example.com,b@example.com" } },
    ],
    ["a text for to", { ...email, to: "x" }],
    ["a null to", { ...email, to: null }],
    ["a blank recipientId", { ...email, recipientId: " " }],
    ["null merge tags", { ...email, mergeTags: null }],
    [
      "an array of merge tags",
      { ...email, mergeTags: [{ tagName: "a", tagValue: "b" }] },
    ],
    ["a blank tag name", { ...email, mergeTags: { " ": "x" } }],
    [
      "a tag name with a percent sign",
      { ...email, mergeTags: { "%fixtureTag%": "x" } },
    ],
    [
      "tag names that differ only in case",
      { ...email, mergeTags: { fixtureTag: "a", FIXTURETAG: "b" } },
    ],
    ["a non-string tag value", { ...email, mergeTags: { fixtureTag: 1 } }],
    ["an empty idempotencyKey", { ...email, idempotencyKey: "" }],
    ["a blank idempotencyKey", { ...email, idempotencyKey: "   " }],
    [
      "a 201-character idempotencyKey",
      { ...email, idempotencyKey: "k".repeat(201) },
    ],
    ["a non-string idempotencyKey", { ...email, idempotencyKey: 7 }],
    ["a null input", null],
  ];
  it.each(invalid)("rejects %s", (_label, input) => {
    expectInvalid(
      () => validateSendInput(cast<SendByTemplateInput>(input)),
      "send",
    );
  });
});

describe("stats.list", () => {
  const query: StatsQuery = { channel: "email", timeZone: "UTC" };

  it("accepts a full query", () => {
    const full: StatsQuery = {
      channel: "sms",
      timeZone: "Europe/Berlin",
      notificationLogId: placeholderId(1),
      recipientId: "fixture-recipient",
      email: EMAIL,
      phone: PHONE,
      status: 0,
      from: "2026-10-11T00:00:00",
      to: "2026-10-12T23:59:59",
      skip: 0,
      top: 100,
    };
    expect(() => validateStatsQuery(full)).not.toThrow();
    expect(() => validateStatsQuery({ ...query, top: 1 })).not.toThrow();
    expect(() => validateStatsQuery(query)).not.toThrow();
  });

  const invalid: [string, unknown][] = [
    ["a blank timeZone", { ...query, timeZone: "  " }],
    ["a missing timeZone", { channel: "email" }],
    ["an unknown channel", { ...query, channel: "push" }],
    ["a top of 0", { ...query, top: 0 }],
    ["a top of 101", { ...query, top: 101 }],
    ["a fractional top", { ...query, top: 1.5 }],
    ["a negative skip", { ...query, skip: -1 }],
    ["a fractional skip", { ...query, skip: 1.5 }],
    ["a from with a space", { ...query, from: "2026-10-11 00:00:00" }],
    ["a to with a Z", { ...query, to: "2026-10-11T00:00:00Z" }],
    ["a from with milliseconds", { ...query, from: "2026-10-11T00:00:00.000" }],
    ["a phone without a digit", { ...query, phone: "+" }],
    ["a negative status", { ...query, status: -1 }],
    ["a fractional status", { ...query, status: 1.5 }],
    ["a null query", null],
  ];
  it.each(invalid)("rejects %s", (_label, input) => {
    expectInvalid(
      () => validateStatsQuery(cast<StatsQuery>(input)),
      "stats.list",
    );
  });
});

describe("stats.details", () => {
  const input = {
    channel: "email",
    notificationLogId: placeholderId(1),
  } as const;

  it("accepts an e-mail or SMS log id", () => {
    expect(() => validateStatsDetails(input)).not.toThrow();
    expect(() =>
      validateStatsDetails({ ...input, channel: "sms" }),
    ).not.toThrow();
  });

  const invalid: [string, unknown][] = [
    ["an unknown channel", { ...input, channel: "push" }],
    ["a blank notificationLogId", { ...input, notificationLogId: " " }],
    ["a missing notificationLogId", { channel: "email" }],
    ["a null input", null],
  ];
  it.each(invalid)("rejects %s", (_label, value) => {
    expectInvalid(() => validateStatsDetails(cast(value)), "stats.details");
  });
});

describe("preferences", () => {
  const operations: PreferenceLookupOperation[] = [
    "preferences.get",
    "preferences.history",
  ];

  it("accepts a lookup by recipientId for both operations", () => {
    for (const operation of operations) {
      expect(() =>
        validatePreferenceLookup(operation, {
          recipientId: "fixture-recipient",
        }),
      ).not.toThrow();
    }
  });

  it.each(operations)("rejects a blank recipientId for %s", (operation) => {
    expectInvalid(
      () => validatePreferenceLookup(operation, { recipientId: "  " }),
      operation,
    );
  });

  it("rejects a missing recipientId and a null lookup", () => {
    expectInvalid(
      () => validatePreferenceLookup("preferences.get", cast({})),
      "preferences.get",
    );
    expectInvalid(
      () => validatePreferenceLookup("preferences.history", cast(null)),
      "preferences.history",
    );
  });

  const change = { preferenceType: "Fixture category", email: true };

  it("accepts an update identified by phone only", () => {
    expect(() =>
      validatePreferenceUpdate({ phone: PHONE, changes: [change] }),
    ).not.toThrow();
  });

  it("accepts a reason of exactly 100 characters", () => {
    const changes = [{ ...change, unsubscribeReason: "r".repeat(100) }];
    expect(() =>
      validatePreferenceUpdate({ recipientId: "fixture-recipient", changes }),
    ).not.toThrow();
  });

  const identified = { recipientId: "fixture-recipient" };
  const invalid: [string, unknown][] = [
    ["an update without any identifier", { changes: [change] }],
    [
      "blank identifiers",
      { recipientId: " ", email: "", phone: "  ", changes: [change] },
    ],
    ["an empty changes list", { ...identified, changes: [] }],
    ["changes that are not a list", { ...identified, changes: change }],
    [
      "a 101-character reason",
      {
        ...identified,
        changes: [{ ...change, unsubscribeReason: "r".repeat(101) }],
      },
    ],
    ["a change that is not an object", { ...identified, changes: [null] }],
    ["a null update", null],
  ];
  it.each(invalid)("rejects %s", (_label, update) => {
    expectInvalid(
      () => validatePreferenceUpdate(cast(update)),
      "preferences.update",
    );
  });
});
