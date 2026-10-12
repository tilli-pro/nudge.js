import { describe, expect, it, type Mock, vi } from "vitest";
import { classifyResponse, isRecord, readField } from "../src/classify.js";
import { createNudgeClient } from "../src/client.js";
import { isNudgeError } from "../src/errors.js";
import { createHttpTransport } from "../src/http-transport.js";
import {
  FIXTURE_OUTCOMES,
  fixtureResponseText,
  loadFixture,
  loadFixtures,
  placeholderId,
} from "./helpers/fixtures.js";
import type { NudgeClient } from "../src/client.js";
import type { NudgeError } from "../src/errors.js";
import type { SendByTemplateInput } from "../src/send.js";
import type { Fixture } from "./helpers/fixtures.js";

const BASE_URL = "https://nudge.example.com/api";
const API_KEY = "test-api-key";
const EMAIL = "recipient-1@example.com";
const PHONE = "+15550100001";
const REF = "fixture-ref";
const TAGS = { fixtureTag: "fixture value" };

type FetchStub = Mock<typeof globalThis.fetch>;
type Wire = any;

// Requests the client never sends: validation refuses the first, the second cannot bind on purpose.
const TRANSPORT_ONLY = ["send.duplicate-tag", "send.problem-details"];

function emailSend(
  overrides: Partial<SendByTemplateInput> = {},
): SendByTemplateInput {
  return {
    externalRef: REF,
    channel: "email",
    to: { email: EMAIL },
    mergeTags: TAGS,
    ...overrides,
  };
}

function smsSend(
  overrides: Partial<SendByTemplateInput> = {},
): SendByTemplateInput {
  return {
    externalRef: REF,
    channel: "sms",
    to: { phone: PHONE },
    mergeTags: TAGS,
    ...overrides,
  };
}

function bodyRecord(name: string): Readonly<Record<string, unknown>> {
  const body = loadFixture(name).request.body;
  if (!isRecord(body)) throw new Error(`fixture ${name} has no request body`);
  return body;
}

function text(record: unknown, key: string): string {
  const value = readField(record, key);
  if (typeof value !== "string") throw new Error(`${key} is not a string`);
  return value;
}

function count(record: unknown, key: string): number {
  const value = readField(record, key);
  if (typeof value !== "number") throw new Error(`${key} is not a number`);
  return value;
}

function listWindow(client: NudgeClient, name: string) {
  const body = bodyRecord(name);
  const [timeZone, email, from, to] = [
    "ianaTimeZoneId",
    "email",
    "fromTime",
    "toTime",
  ].map((key) => text(body, key));
  return client.stats.list({
    channel: "email",
    timeZone,
    email,
    from,
    to,
    top: count(body, "top"),
  });
}

function updateFirstChange(client: NudgeClient, name: string): Promise<void> {
  const preferences = readField(bodyRecord(name), "preferences");
  const first: unknown = Array.isArray(preferences)
    ? preferences[0]
    : undefined;
  const changes = [
    { preferenceType: text(first, "preferenceType"), email: true },
  ];
  return client.preferences.update({
    recipientId: "fixture-recipient",
    email: EMAIL,
    changes,
  });
}

const sendPlainEmail = (client: NudgeClient) =>
  client.sendByTemplate(emailSend());
const sendKeyed = (client: NudgeClient) =>
  client.sendByTemplate(emailSend({ idempotencyKey: placeholderId(1) }));
const details = (client: NudgeClient) =>
  client.stats.details({
    channel: "email",
    notificationLogId: placeholderId(1),
  });
const lookup = { recipientId: "fixture-recipient" };
const link = {
  fixtureTag: "fixture value",
  Unsubscribe: "https://example.com/unsubscribe",
};

const CALLS: Record<string, (client: NudgeClient) => Promise<unknown>> = {
  "send.accepted": sendKeyed,
  "send.replay": sendKeyed,
  "send.unknown-ref": (client) =>
    client.sendByTemplate(emailSend({ externalRef: "fixture-ref-unknown" })),
  "send.inactive-nudge": (client) =>
    client.sendByTemplate(emailSend({ externalRef: "fixture-ref-inactive" })),
  "send.missing-merge-tag": (client) =>
    client.sendByTemplate(emailSend({ mergeTags: {} })),
  "send.link-tag-refused": (client) =>
    client.sendByTemplate(emailSend({ mergeTags: link })),
  "send.unauthorized-key": sendPlainEmail,
  "send.ip-not-allowed": sendPlainEmail,
  "send.rate-limited-account": sendPlainEmail,
  "send.rate-limited-recipient": sendPlainEmail,
  "send.recipient-failed": sendPlainEmail,
  "send.all-unsubscribed": sendPlainEmail,
  "send.server-error": sendPlainEmail,
  "send.not-enough-balance": (client) => client.sendByTemplate(smsSend()),
  "send.exception-filter": sendPlainEmail,
  "send.sms-accepted": (client) =>
    client.sendByTemplate(smsSend({ idempotencyKey: placeholderId(1) })),
  "send.sms-number-refused": (client) =>
    client.sendByTemplate(smsSend({ to: { phone: "+1555" } })),
  "stats.list.window": (client) => listWindow(client, "stats.list.window"),
  "stats.details.null-merge-tags": details,
  "stats.details.merge-tags": details,
  "stats.details.unknown-id": details,
  "preferences.get.found": (client) => client.preferences.get(lookup),
  "preferences.history.found": (client) => client.preferences.history(lookup),
  "preferences.update.accepted": (client) =>
    updateFirstChange(client, "preferences.update.accepted"),
  "preferences.update.refused": (client) =>
    updateFirstChange(client, "preferences.update.refused"),
};

const preferenceList = (body: Wire) =>
  body.map((item: Wire) => ({
    preferenceType: item.preferenceType,
    channel: String(item.channel).toLowerCase(),
    isSubscribed: item.isSubscribed,
    lastModifiedOn: item.lastModifiedOn ?? null,
    modifiedBy: item.modifiedBy ?? null,
    unsubscribeReason: item.unsubscribeReason ?? null,
    termsVersion: item.termsVersion ?? null,
    ipAddress: item.ipAddress ?? null,
    confirmationSentOn: item.subscribeConfEmailSentTime ?? null,
  }));

// What a success must resolve to, written from the recorded response body and independent of src/.
const RESULTS: Record<string, (body: Wire) => unknown> = {
  send: (body) => ({
    accepted: true,
    notificationLogId: body.NotificationLogId,
  }),
  "stats.list": (body) => ({
    entries: body.data.pageData.map((entry: Wire) => ({
      notificationLogId: entry.guid,
      recipientId: entry.recipientId ?? null,
      email: entry.toEmail ?? null,
      phone: entry.mobileNumber ?? null,
      scheduledOn: entry.scheduledOn,
      sentOn: entry.sentOn ?? null,
      status: entry.status,
      statusText: entry.statusText,
      failureDescription: entry.failureDescription ?? null,
      nudgeName: entry.nudgeName ?? null,
      clicksCount: entry.clicksCount,
    })),
  }),
  "stats.details": ({ data }) => ({
    notificationLogId: data.id,
    recipientId: data.recipientId ?? null,
    email: data.email ?? null,
    phone: data.phoneNumber ?? null,
    status: data.status,
    customFields: data.customFields ?? {},
    paymentUrl: data.paymentUrl ?? null,
    mergeTags: (data.mergeTags ?? []).map((tag: Wire) => ({
      name: tag.name,
      value: tag.value ?? "",
      isServiceTag: tag.isServiceTag === true,
    })),
  }),
  "preferences.get": preferenceList,
  "preferences.history": preferenceList,
  "preferences.update": () => undefined,
};

function replay(fixture: Fixture): FetchStub {
  const { status, headers } = fixture.response;
  return vi.fn<typeof globalThis.fetch>(
    async () =>
      new Response(fixtureResponseText(fixture) || null, { status, headers }),
  );
}

function sentCall(fetchStub: FetchStub): { url: string; init: RequestInit } {
  expect(fetchStub).toHaveBeenCalledTimes(1);
  const call = fetchStub.mock.lastCall;
  if (!call) throw new Error("fetch was not called");
  return { url: String(call[0]), init: call[1] ?? {} };
}

function expectSentRequest(fetchStub: FetchStub, fixture: Fixture): void {
  const { url, init } = sentCall(fetchStub);
  const { query, path, method, body } = fixture.request;
  const suffix =
    query === undefined || Object.keys(query).length === 0
      ? ""
      : `?${new URLSearchParams(query)}`;
  expect(url).toBe(`${BASE_URL}/${path}${suffix}`);
  expect(init.method).toBe(method);
  if (body === undefined) expect(init.body).toBeUndefined();
  else expect(JSON.parse(String(init.body))).toEqual(body);
  expect(new Headers(init.headers).get("authorization")).toBe(API_KEY);
}

async function failure(promise: Promise<unknown>): Promise<NudgeError> {
  try {
    await promise;
  } catch (error) {
    if (isNudgeError(error)) return error;
    throw error;
  }
  throw new Error("expected the call to reject");
}

describe("every fixture", () => {
  it("covers every fixture", () => {
    expect([...Object.keys(CALLS), ...TRANSPORT_ONLY].sort()).toEqual(
      loadFixtures().map((fixture) => fixture.name),
    );
  });

  it.each(Object.keys(CALLS))(
    "%s: sends the recorded request and gets its outcome",
    async (name) => {
      const fixture = loadFixture(name);
      const outcome = FIXTURE_OUTCOMES[name];
      const call = CALLS[name];
      if (outcome === undefined || call === undefined)
        throw new Error(`no outcome or call for ${name}`);
      const fetchStub = replay(fixture);
      const client = createNudgeClient({
        apiKey: API_KEY,
        baseUrl: BASE_URL,
        fetch: fetchStub,
      });
      if (outcome.ok) {
        const result = RESULTS[fixture.operation];
        if (result === undefined)
          throw new Error(`no expected result for ${fixture.operation}`);
        await expect(call(client)).resolves.toEqual(
          result(fixture.response.body),
        );
      } else {
        const { code, status, nudgeErrCode, notificationLogId } = outcome;
        const error = await failure(call(client));
        expect(error).toMatchObject({
          code,
          operation: fixture.operation,
          status,
          nudgeErrCode,
          notificationLogId,
        });
      }
      expectSentRequest(fetchStub, fixture);
    },
  );

  it("stats.list sends to unchanged and returns a log from Nudge's extra day", async () => {
    const fixture = loadFixture("stats.list.window");
    const fetchStub = replay(fixture);
    const client = createNudgeClient({
      apiKey: API_KEY,
      baseUrl: BASE_URL,
      fetch: fetchStub,
    });
    const to = text(bodyRecord(fixture.name), "toTime");
    const page = await listWindow(client, fixture.name);
    expect(
      readField(JSON.parse(String(sentCall(fetchStub).init.body)), "toTime"),
    ).toBe(to);
    expect(page.entries.some((entry) => entry.scheduledOn > to)).toBe(true);
  });

  it.each(TRANSPORT_ONLY)(
    "%s classifies through the HTTP transport",
    async (name) => {
      const fixture = loadFixture(name);
      const outcome = FIXTURE_OUTCOMES[name];
      if (outcome === undefined || outcome.ok)
        throw new Error(`${name} must be an error outcome`);
      const fetchStub = replay(fixture);
      const transport = createHttpTransport({
        apiKey: API_KEY,
        baseUrl: BASE_URL,
        fetch: fetchStub,
      });
      const { operation, request } = fixture;
      const response = await transport.request({
        operation,
        method: request.method,
        path: request.path,
        body: request.body,
      });
      expectSentRequest(fetchStub, fixture);
      const { code, status, nudgeErrCode, notificationLogId } = outcome;
      expect(classifyResponse(operation, response)).toMatchObject({
        code,
        operation,
        status,
        nudgeErrCode,
        notificationLogId,
      });
    },
  );

  it("refuses the duplicate tag before any request", async () => {
    const tags = readField(bodyRecord("send.duplicate-tag"), "mergeTags");
    if (!Array.isArray(tags))
      throw new Error("the fixture has no merge tag list");
    const mergeTags = Object.fromEntries(
      tags.map((tag) => [text(tag, "tagName"), text(tag, "tagValue")]),
    );
    expect(Object.keys(mergeTags)).toEqual(["fixtureTag", "FIXTURETAG"]);
    const fetchStub: FetchStub = vi.fn<typeof globalThis.fetch>();
    const client = createNudgeClient({
      apiKey: API_KEY,
      baseUrl: BASE_URL,
      fetch: fetchStub,
    });
    const error = await failure(
      client.sendByTemplate(emailSend({ mergeTags })),
    );
    expect(error).toMatchObject({
      code: "invalid",
      operation: "send",
      status: null,
    });
    expect(fetchStub).not.toHaveBeenCalled();
  });
});
