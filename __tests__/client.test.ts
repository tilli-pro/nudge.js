import { afterEach, describe, expect, it, type Mock, vi } from "vitest";
import { createNudgeClient } from "../src/client.js";
import { isNudgeError } from "../src/errors.js";
import { placeholderId } from "./helpers/fixtures.js";
import type {
  NudgeRequest,
  NudgeResponse,
  NudgeTransport,
} from "../src/classify.js";
import type { NudgeClient } from "../src/client.js";
import type { NudgeError } from "../src/errors.js";
import type { SendByTemplateInput } from "../src/send.js";

const BASE_URL = "https://nudge.example.com/api";
const API_KEY = "test-api-key";
const EMAIL = "recipient-1@example.com";
const REF = "fixture-ref";

const SEND: SendByTemplateInput = {
  externalRef: REF,
  channel: "email",
  to: { email: EMAIL },
  mergeTags: { fixtureTag: "fixture value" },
};

const ACCEPTED = {
  HasErrors: false,
  Code: 200,
  NotificationLogId: placeholderId(2),
  Errors: null,
  Statuses: {},
  OtpSessionId: null,
  ExpiresAt: null,
  NudgeExternalRef: null,
  Results: null,
};
const SERVER_ERROR = {
  HasErrors: true,
  Code: 500,
  Error: "Internal Error. Please contact with our support",
};

const envelope = (data: unknown) => ({
  data,
  code: 200,
  errCode: 0,
  errors: [],
  hasErrors: false,
  errorGuid: null,
});

type FetchStub = Mock<typeof globalThis.fetch>;
type TransportStub = { request: Mock<NudgeTransport["request"]> };

function reply(status: number, body: unknown): NudgeResponse {
  return { status, headers: new Headers(), body };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function stubTransport(): TransportStub {
  return { request: vi.fn<NudgeTransport["request"]>() };
}

function lastRequest(transport: TransportStub): NudgeRequest {
  const call = transport.request.mock.lastCall;
  if (!call) throw new Error("the transport was not called");
  return call[0];
}

function lastFetch(stub: FetchStub): { url: string; init: RequestInit } {
  const call = stub.mock.lastCall;
  if (!call) throw new Error("fetch was not called");
  return { url: String(call[0]), init: call[1] ?? {} };
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected the call to reject");
}

async function failure(promise: Promise<unknown>): Promise<NudgeError> {
  const error = await rejection(promise);
  if (!isNudgeError(error))
    throw new Error("expected a NudgeError", { cause: error });
  return error;
}

// A transport call that settles only when its signal aborts, the way fetch does.
function rejectOnAbort(signal: AbortSignal | null | undefined): Promise<never> {
  return new Promise((_resolve, reject) => {
    if (!signal) return;
    if (signal.aborted) return reject(signal.reason);
    signal.addEventListener("abort", () => reject(signal.reason), {
      once: true,
    });
  });
}

function observe(call: Promise<unknown>): {
  readonly outcome: Promise<unknown>;
  isSettled(): boolean;
} {
  let settled = false;
  const outcome = call
    .then(
      () => "resolved" as unknown,
      (error: unknown) => error,
    )
    .finally(() => {
      settled = true;
    });
  return { outcome, isSettled: () => settled };
}

// AbortSignal.timeout is native and not driven by fake timers: replace it with a signal a fake timer aborts.
function mockTimeoutSignal() {
  return vi.spyOn(AbortSignal, "timeout").mockImplementation((milliseconds) => {
    const controller = new AbortController();
    setTimeout(() => {
      controller.abort(
        new DOMException(
          "The operation was aborted due to timeout",
          "TimeoutError",
        ),
      );
    }, milliseconds);
    return controller.signal;
  });
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("createNudgeClient", () => {
  it("throws invalid synchronously for bad options", () => {
    let caught: unknown;
    try {
      createNudgeClient({ apiKey: "  " });
    } catch (error) {
      caught = error;
    }
    expect(isNudgeError(caught)).toBe(true);
    expect(caught).toMatchObject({
      code: "invalid",
      operation: "createNudgeClient",
      status: null,
    });
  });

  it("makes no request and starts no timer", () => {
    vi.useFakeTimers();
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const any = vi.spyOn(AbortSignal, "any");
    const fetchStub: FetchStub = vi.fn<typeof globalThis.fetch>();
    const transport = stubTransport();
    createNudgeClient({ apiKey: API_KEY, baseUrl: BASE_URL, fetch: fetchStub });
    createNudgeClient({ apiKey: API_KEY, transport });
    expect(timeout).not.toHaveBeenCalled();
    expect(any).not.toHaveBeenCalled();
    expect(fetchStub).not.toHaveBeenCalled();
    expect(transport.request).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("builds the HTTP transport from apiKey, baseUrl and fetch", async () => {
    const fetchStub: FetchStub = vi.fn<typeof globalThis.fetch>(async () =>
      jsonResponse(ACCEPTED),
    );
    const client = createNudgeClient({
      apiKey: API_KEY,
      baseUrl: BASE_URL,
      fetch: fetchStub,
    });
    await expect(client.sendByTemplate(SEND)).resolves.toEqual({
      accepted: true,
      notificationLogId: placeholderId(2),
    });
    const { url, init } = lastFetch(fetchStub);
    expect(url).toBe("https://nudge.example.com/api/v2/Nudge/Send");
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("authorization")).toBe(API_KEY);
  });

  it("works with methods taken off the client", async () => {
    const transport = stubTransport();
    transport.request.mockImplementation(async (request) => {
      if (request.operation === "send") return reply(200, ACCEPTED);
      if (request.operation === "stats.list")
        return reply(200, envelope({ pageData: [] }));
      return reply(200, []);
    });
    const { sendByTemplate, stats, preferences } = createNudgeClient({
      apiKey: API_KEY,
      transport,
    });
    const { list } = stats;
    const { get } = preferences;
    await expect(sendByTemplate(SEND)).resolves.toMatchObject({
      accepted: true,
    });
    await expect(list({ channel: "email", timeZone: "UTC" })).resolves.toEqual({
      entries: [],
    });
    await expect(get({ recipientId: "fixture-recipient" })).resolves.toEqual(
      [],
    );
  });
});

describe("requests", () => {
  it("hands the transport the operation's request with a signal", async () => {
    const transport = stubTransport();
    transport.request.mockResolvedValue(reply(200, ACCEPTED));
    const client = createNudgeClient({ apiKey: API_KEY, transport });
    await client.sendByTemplate({ ...SEND, idempotencyKey: placeholderId(1) });
    expect(transport.request).toHaveBeenCalledTimes(1);
    const request = lastRequest(transport);
    expect(request).toMatchObject({
      operation: "send",
      method: "POST",
      path: "v2/Nudge/Send",
      body: {
        nudgeExternalRef: REF,
        channel: 0,
        toEmailAddress: EMAIL,
        mergeTags: [{ tagName: "fixtureTag", tagValue: "fixture value" }],
        idempotencyKey: placeholderId(1),
      },
    });
    expect(request.signal).toBeInstanceOf(AbortSignal);
  });

  const details = {
    id: placeholderId(1),
    recipientId: null,
    email: EMAIL,
    phoneNumber: null,
    status: "Delivered",
    paymentUrl: null,
    customFields: {},
    mergeTags: null,
  };
  const lookup = { recipientId: "fixture-recipient" };
  const change = { preferenceType: "Fixture category", email: true };
  type Run = (client: NudgeClient) => Promise<unknown>;
  const WIRED: [string, string, string, unknown, Run][] = [
    [
      "stats.list",
      "POST",
      "v1/NotificationStats",
      envelope({ pageData: [] }),
      (c) => c.stats.list({ channel: "sms", timeZone: "UTC" }),
    ],
    [
      "stats.details",
      "GET",
      "v1/NotificationStats/GetNotificationDetails",
      envelope(details),
      (c) =>
        c.stats.details({
          channel: "email",
          notificationLogId: placeholderId(1),
        }),
    ],
    [
      "preferences.get",
      "POST",
      "v1/CustomerPreference/Get",
      [],
      (c) => c.preferences.get(lookup),
    ],
    [
      "preferences.history",
      "POST",
      "v1/CustomerPreference/GetHistory",
      [],
      (c) => c.preferences.history(lookup),
    ],
    [
      "preferences.update",
      "POST",
      "v1/CustomerPreference/Update",
      envelope({ success: true }),
      (c) => c.preferences.update({ ...lookup, changes: [change] }),
    ],
  ];
  it.each(WIRED)(
    "wires %s to its own request and reader",
    async (operation, method, path, body, run) => {
      const transport = stubTransport();
      transport.request.mockResolvedValue(reply(200, body));
      await run(createNudgeClient({ apiKey: API_KEY, transport }));
      expect(transport.request).toHaveBeenCalledTimes(1);
      expect(lastRequest(transport)).toMatchObject({ operation, method, path });
    },
  );

  it("rejects invalid input without a request", async () => {
    const transport = stubTransport();
    const client = createNudgeClient({ apiKey: API_KEY, transport });
    const sendError = await failure(
      client.sendByTemplate({ ...SEND, externalRef: "" }),
    );
    expect(sendError).toMatchObject({
      code: "invalid",
      operation: "send",
      status: null,
    });
    const listError = await failure(
      client.stats.list({ channel: "email", timeZone: "" }),
    );
    expect(listError).toMatchObject({
      code: "invalid",
      operation: "stats.list",
      status: null,
    });
    const updateError = await failure(
      client.preferences.update({
        recipientId: "fixture-recipient",
        changes: [],
      }),
    );
    expect(updateError).toMatchObject({
      code: "invalid",
      operation: "preferences.update",
      status: null,
    });
    expect(transport.request).not.toHaveBeenCalled();
  });
});

describe("timeout", () => {
  it("times out after 10 seconds by default", async () => {
    vi.useFakeTimers();
    const timeout = mockTimeoutSignal();
    const fetchStub: FetchStub = vi.fn<typeof globalThis.fetch>((_url, init) =>
      rejectOnAbort(init?.signal),
    );
    const client = createNudgeClient({
      apiKey: API_KEY,
      baseUrl: BASE_URL,
      fetch: fetchStub,
    });
    const { outcome, isSettled } = observe(client.sendByTemplate(SEND));
    await vi.advanceTimersByTimeAsync(9_999);
    expect(isSettled()).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const error = await outcome;
    expect(isNudgeError(error)).toBe(true);
    expect(error).toMatchObject({
      code: "timeout",
      operation: "send",
      status: null,
      retryable: true,
    });
    expect(timeout).toHaveBeenCalledTimes(1);
    expect(timeout).toHaveBeenCalledWith(10_000);
    expect(fetchStub).toHaveBeenCalledTimes(1);
  });

  it("uses timeoutMs", async () => {
    vi.useFakeTimers();
    const timeout = mockTimeoutSignal();
    const fetchStub: FetchStub = vi.fn<typeof globalThis.fetch>((_url, init) =>
      rejectOnAbort(init?.signal),
    );
    const client = createNudgeClient({
      apiKey: API_KEY,
      baseUrl: BASE_URL,
      fetch: fetchStub,
      timeoutMs: 250,
    });
    const { outcome, isSettled } = observe(
      client.stats.list({ channel: "email", timeZone: "UTC" }),
    );
    await vi.advanceTimersByTimeAsync(249);
    expect(isSettled()).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await outcome).toMatchObject({
      code: "timeout",
      operation: "stats.list",
      status: null,
    });
    expect(timeout).toHaveBeenCalledWith(250);
  });

  it("applies the timeout to any transport", async () => {
    vi.useFakeTimers();
    mockTimeoutSignal();
    const transport = stubTransport();
    transport.request.mockImplementation((request) =>
      rejectOnAbort(request.signal),
    );
    const client = createNudgeClient({ apiKey: API_KEY, transport });
    const { outcome, isSettled } = observe(
      client.preferences.get({ recipientId: "fixture-recipient" }),
    );
    await vi.advanceTimersByTimeAsync(9_999);
    expect(isSettled()).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await outcome).toMatchObject({
      code: "timeout",
      operation: "preferences.get",
      status: null,
    });
  });
});

describe("caller abort", () => {
  it("rethrows the caller's reason untouched", async () => {
    const reason = new Error("caller gave up");
    const controller = new AbortController();
    controller.abort(reason);
    const fetchStub: FetchStub = vi.fn<typeof globalThis.fetch>((_url, init) =>
      rejectOnAbort(init?.signal),
    );
    const client = createNudgeClient({
      apiKey: API_KEY,
      baseUrl: BASE_URL,
      fetch: fetchStub,
    });
    const error = await rejection(
      client.sendByTemplate(SEND, { signal: controller.signal }),
    );
    expect(error).toBe(reason);
    expect(isNudgeError(error)).toBe(false);
  });

  it("aborts the transport's signal when the caller aborts", async () => {
    const controller = new AbortController();
    const transport = stubTransport();
    transport.request.mockImplementation((request) =>
      rejectOnAbort(request.signal),
    );
    const client = createNudgeClient({ apiKey: API_KEY, transport });
    const call = rejection(
      client.sendByTemplate(SEND, { signal: controller.signal }),
    );
    const { signal } = lastRequest(transport);
    expect(signal?.aborted).toBe(false);
    const reason = new Error("caller stopped");
    controller.abort(reason);
    expect(await call).toBe(reason);
    expect(signal?.aborted).toBe(true);
  });
});

describe("failures", () => {
  it("answers network with the transport's error as cause", async () => {
    const transport = stubTransport();
    const client = createNudgeClient({ apiKey: API_KEY, transport });
    const cause = new TypeError("fetch failed");
    transport.request.mockRejectedValueOnce(cause);
    const rejected = await failure(client.sendByTemplate(SEND));
    expect(rejected).toMatchObject({
      code: "network",
      operation: "send",
      status: null,
      retryable: true,
    });
    expect(rejected.cause).toBe(cause);
    transport.request.mockImplementationOnce(() => {
      throw cause;
    });
    const thrown = await failure(client.sendByTemplate(SEND));
    expect(thrown).toMatchObject({
      code: "network",
      operation: "send",
      status: null,
    });
    expect(thrown.cause).toBe(cause);
  });

  it("answers server for a body the operation cannot read", async () => {
    const transport = stubTransport();
    const client = createNudgeClient({ apiKey: API_KEY, transport });
    transport.request.mockResolvedValueOnce(reply(200, envelope({})));
    const listError = await failure(
      client.stats.list({ channel: "email", timeZone: "UTC" }),
    );
    expect(listError).toMatchObject({
      code: "server",
      operation: "stats.list",
      status: 200,
    });
    transport.request.mockResolvedValueOnce(
      reply(200, envelope({ success: false })),
    );
    const change = { preferenceType: "Fixture category", email: true };
    const updateError = await failure(
      client.preferences.update({
        recipientId: "fixture-recipient",
        changes: [change],
      }),
    );
    expect(updateError).toMatchObject({
      code: "server",
      operation: "preferences.update",
      status: 200,
    });
  });

  it("makes one request on a server error", async () => {
    const transport = stubTransport();
    transport.request.mockResolvedValue(reply(500, SERVER_ERROR));
    const client = createNudgeClient({ apiKey: API_KEY, transport });
    const error = await failure(client.sendByTemplate(SEND));
    expect(error).toMatchObject({
      code: "server",
      operation: "send",
      status: 500,
      retryable: true,
    });
    expect(transport.request).toHaveBeenCalledTimes(1);
  });
});

describe("results", () => {
  it("resolves a send with its log id", async () => {
    const transport = stubTransport();
    transport.request.mockResolvedValue(reply(200, ACCEPTED));
    const client = createNudgeClient({ apiKey: API_KEY, transport });
    await expect(client.sendByTemplate(SEND)).resolves.toEqual({
      accepted: true,
      notificationLogId: placeholderId(2),
    });
  });

  it("resolves update with undefined", async () => {
    const transport = stubTransport();
    transport.request.mockResolvedValue(
      reply(200, envelope({ success: true })),
    );
    const client = createNudgeClient({ apiKey: API_KEY, transport });
    const change = { preferenceType: "Fixture category", sms: false };
    await expect(
      client.preferences.update({
        recipientId: "fixture-recipient",
        changes: [change],
      }),
    ).resolves.toBeUndefined();
  });
});

describe("silence", () => {
  it("logs nothing on success, failure or invalid input", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map(
      (name) => vi.spyOn(console, name).mockImplementation(() => undefined),
    );
    const transport = stubTransport();
    transport.request
      .mockResolvedValueOnce(reply(200, ACCEPTED))
      .mockResolvedValueOnce(reply(500, SERVER_ERROR));
    const client = createNudgeClient({ apiKey: API_KEY, transport });
    await client.sendByTemplate(SEND);
    await failure(client.sendByTemplate(SEND));
    await failure(client.sendByTemplate({ ...SEND, externalRef: "" }));
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });

  it("puts none of the input on an error", async () => {
    const transport = stubTransport();
    transport.request.mockResolvedValue(
      reply(400, {
        HasErrors: true,
        Code: 400,
        Error: "Missing merge tags: fixtureTag",
      }),
    );
    const client = createNudgeClient({ apiKey: API_KEY, transport });
    const input = {
      ...SEND,
      mergeTags: { fixtureTag: "secret tag value" },
      idempotencyKey: "key-1",
    };
    const error = await failure(client.sendByTemplate(input));
    expect(error).toMatchObject({
      code: "invalid",
      operation: "send",
      status: 400,
    });
    const own = Object.getOwnPropertyNames(error).map((name) =>
      String(Reflect.get(error, name)),
    );
    const rendered = [JSON.stringify(error), String(error), ...own];
    for (const secret of [EMAIL, "secret tag value", "key-1", API_KEY]) {
      for (const text of rendered) expect(text).not.toContain(secret);
    }
  });
});
