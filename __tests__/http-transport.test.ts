import { afterEach, describe, expect, it, type Mock, vi } from "vitest";
import { isNudgeError, NudgeError } from "../src/errors.js";
import {
  assertConnectionOptions,
  createHttpTransport,
  DEFAULT_BASE_URL,
  type HttpTransportOptions,
} from "../src/http-transport.js";
import type { NudgeRequest } from "../src/classify.js";

const BASE_URL = "https://nudge.example.com/api";
const API_KEY = "test-api-key";

type FetchStub = Mock<typeof globalThis.fetch>;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// A fetch stub that answers every call with a fresh Response.
function answering(text = "", init: ResponseInit = { status: 200 }): FetchStub {
  return vi.fn<typeof globalThis.fetch>(async () => new Response(text, init));
}

// The URL string and the init that one fetch call received.
function sent(
  stub: FetchStub,
  index = 0,
): { readonly url: string; readonly init: RequestInit } {
  const call = stub.mock.calls[index];
  if (call === undefined) {
    throw new Error(`fetch call ${index} did not happen`);
  }
  const [url, init] = call;
  if (typeof url !== "string") {
    throw new Error("fetch was not given a URL string");
  }
  return { url, init: init ?? {} };
}

function nudgeRequest(overrides: Partial<NudgeRequest> = {}): NudgeRequest {
  return {
    operation: "send",
    method: "POST",
    path: "v2/Nudge/Send",
    ...overrides,
  };
}

function transportOn(stub: FetchStub, baseUrl = BASE_URL) {
  return createHttpTransport({ apiKey: API_KEY, baseUrl, fetch: stub });
}

// For options that the type system would refuse.
function build(options: unknown) {
  return createHttpTransport(options as HttpTransportOptions);
}

function thrownBy(action: () => unknown): unknown {
  try {
    action();
  } catch (error) {
    return error;
  }
  return;
}

function expectInvalid(error: unknown, operation: string): void {
  expect(error).toBeInstanceOf(NudgeError);
  expect(isNudgeError(error)).toBe(true);
  expect(error).toMatchObject({
    code: "invalid",
    operation,
    status: null,
    retryable: false,
  });
  expect((error as NudgeError).message).toBe(`nudge ${operation}: invalid`);
}

describe("createHttpTransport", () => {
  describe("URL", () => {
    it("joins the base and the path with one slash", async () => {
      const stub = answering();
      await transportOn(stub).request(
        nudgeRequest({
          operation: "stats.list",
          path: "v1/NotificationStats",
        }),
      );
      // 0.1.0 doubled the /api segment; the base already ends in it.
      expect(sent(stub).url).toBe(
        "https://nudge.example.com/api/v1/NotificationStats",
      );
    });

    it.each([
      "https://nudge.example.com/api/",
      "https://nudge.example.com/api//",
    ])("strips trailing slashes from the base %s", async (baseUrl) => {
      const stub = answering();
      await transportOn(stub, baseUrl).request(nudgeRequest());
      expect(sent(stub).url).toBe(
        "https://nudge.example.com/api/v2/Nudge/Send",
      );
    });

    it("appends the query with URLSearchParams", async () => {
      const stub = answering();
      await transportOn(stub).request(
        nudgeRequest({
          operation: "stats.details",
          method: "GET",
          path: "v1/NotificationStats/GetNotificationDetails",
          query: { channel: "Email", notificationLogId: "a b&c" },
        }),
      );
      expect(sent(stub).url).toBe(
        `${BASE_URL}/v1/NotificationStats/GetNotificationDetails?channel=Email&notificationLogId=a+b%26c`,
      );
    });

    it("adds no question mark without a query or with an empty one", async () => {
      const stub = answering();
      const transport = transportOn(stub);
      await transport.request(nudgeRequest({ path: "v1/Lists" }));
      await transport.request(nudgeRequest({ path: "v1/Lists", query: {} }));
      expect(sent(stub, 0).url).toBe(`${BASE_URL}/v1/Lists`);
      expect(sent(stub, 1).url).toBe(`${BASE_URL}/v1/Lists`);
    });

    it("defaults to the production API root", async () => {
      const stub = answering();
      await createHttpTransport({ apiKey: API_KEY, fetch: stub }).request(
        nudgeRequest(),
      );
      await createHttpTransport({
        apiKey: API_KEY,
        baseUrl: undefined,
        fetch: stub,
      }).request(nudgeRequest());
      expect(sent(stub, 0).url).toBe("https://app.nudge.net/api/v2/Nudge/Send");
      expect(sent(stub, 1).url).toBe("https://app.nudge.net/api/v2/Nudge/Send");
    });
  });

  describe("request", () => {
    it("sends the key raw in authorization and asks for JSON", async () => {
      const stub = answering();
      await transportOn(stub).request(nudgeRequest());
      // The raw key, no "Bearer " prefix.
      expect(sent(stub).init.headers).toEqual({
        authorization: API_KEY,
        accept: "application/json",
      });
    });

    it("sends the key exactly as given, padding included", async () => {
      const stub = answering();
      await createHttpTransport({
        apiKey: " padded-key ",
        baseUrl: BASE_URL,
        fetch: stub,
      }).request(nudgeRequest());
      expect(sent(stub).init.headers).toEqual({
        authorization: " padded-key ",
        accept: "application/json",
      });
    });

    it("serialises a body and labels it JSON", async () => {
      const stub = answering();
      const body = {
        nudgeExternalRef: "fixture-ref",
        channel: 0,
        mergeTags: [{ tagName: "fixtureTag", tagValue: "fixture value" }],
      };
      await transportOn(stub).request(nudgeRequest({ body }));
      const { init } = sent(stub);
      expect(init.method).toBe("POST");
      expect(init.body).toBe(JSON.stringify(body));
      expect(init.headers).toEqual({
        authorization: API_KEY,
        accept: "application/json",
        "content-type": "application/json",
      });
    });

    it("treats a null body as a body, not as none", async () => {
      const stub = answering();
      await transportOn(stub).request(nudgeRequest({ body: null }));
      const { init } = sent(stub);
      expect(init.body).toBe("null");
      expect(init.headers).toEqual({
        authorization: API_KEY,
        accept: "application/json",
        "content-type": "application/json",
      });
    });

    it("sends no body and no content-type without one", async () => {
      const stub = answering();
      await transportOn(stub).request(
        nudgeRequest({ method: "GET", path: "v1/Lists" }),
      );
      const { init } = sent(stub);
      expect("body" in init).toBe(false);
      expect(init.headers).toEqual({
        authorization: API_KEY,
        accept: "application/json",
      });
    });

    it.each(["GET", "POST", "PUT", "PATCH", "DELETE"] as const)(
      "forwards the %s method and any path",
      async (method) => {
        const stub = answering();
        await transportOn(stub).request(
          nudgeRequest({
            operation: "lists.delete",
            method,
            path: "v1/Lists/42",
          }),
        );
        const { url, init } = sent(stub);
        expect(url).toBe(`${BASE_URL}/v1/Lists/42`);
        expect(init.method).toBe(method);
      },
    );

    it("forwards the request's signal", async () => {
      const stub = answering();
      const { signal } = new AbortController();
      await transportOn(stub).request(nudgeRequest({ signal }));
      expect(sent(stub).init.signal).toBe(signal);
    });
  });

  describe("response", () => {
    it("reads an empty body as null", async () => {
      const result = await transportOn(answering("")).request(nudgeRequest());
      expect(result.status).toBe(200);
      expect(result.body).toBeNull();
    });

    it("parses JSON whatever the content type says", async () => {
      const object = await transportOn(
        answering('{"HasErrors":false,"Code":200}', {
          status: 200,
          headers: { "content-type": "text/plain" },
        }),
      ).request(nudgeRequest());
      expect(object.body).toEqual({ HasErrors: false, Code: 200 });

      const array = await transportOn(
        answering('[{"preferenceType":"Fixture category"}]'),
      ).request(nudgeRequest());
      expect(array.body).toEqual([{ preferenceType: "Fixture category" }]);
    });

    it("keeps text that is not JSON", async () => {
      const result = await transportOn(
        answering("Bad Gateway", { status: 502 }),
      ).request(nudgeRequest());
      expect(result.status).toBe(502);
      expect(result.body).toBe("Bad Gateway");
    });

    it("returns status and headers as received, without classifying", async () => {
      const response = new Response('{"HasErrors":true}', {
        status: 500,
        headers: { "retry-after": "30" },
      });
      const stub = vi.fn<typeof globalThis.fetch>(async () => response);
      const result = await transportOn(stub).request(nudgeRequest());
      expect(result.status).toBe(500);
      expect(result.headers).toBe(response.headers);
      expect(result.body).toEqual({ HasErrors: true });
    });

    it("rejects with fetch's own error when no response exists", async () => {
      const failure = new TypeError("fetch failed");
      const stub = vi.fn<typeof globalThis.fetch>().mockRejectedValue(failure);
      await expect(transportOn(stub).request(nudgeRequest())).rejects.toBe(
        failure,
      );
    });

    it("rejects with the read error when the body cannot be read", async () => {
      const failure = new Error("body stream broke");
      const unreadable = {
        status: 200,
        headers: new Headers(),
        text: () => Promise.reject(failure),
      };
      const stub = vi.fn<typeof globalThis.fetch>(
        async () => unreadable as unknown as Response,
      );
      await expect(transportOn(stub).request(nudgeRequest())).rejects.toBe(
        failure,
      );
    });

    it("turns a synchronous throw from fetch into a rejection", async () => {
      const failure = new Error("fetch threw");
      const stub = vi.fn<typeof globalThis.fetch>(() => {
        throw failure;
      });
      const pending = transportOn(stub).request(nudgeRequest());
      await expect(pending).rejects.toBe(failure);
    });
  });

  describe("fetch", () => {
    it("uses the fetch option and never the global", async () => {
      const globalStub = answering();
      vi.stubGlobal("fetch", globalStub);
      const optionStub = answering();
      await transportOn(optionStub).request(nudgeRequest());
      expect(optionStub).toHaveBeenCalledTimes(1);
      expect(globalStub).not.toHaveBeenCalled();
    });

    it("reads the global fetch at each request", async () => {
      const transport = createHttpTransport({
        apiKey: API_KEY,
        baseUrl: BASE_URL,
      });
      const first = answering();
      const second = answering();
      vi.stubGlobal("fetch", first);
      await transport.request(nudgeRequest());
      vi.stubGlobal("fetch", second);
      await transport.request(nudgeRequest());
      expect(first).toHaveBeenCalledTimes(1);
      expect(second).toHaveBeenCalledTimes(1);
    });

    it("captures its options at construction", async () => {
      const stub = answering();
      const options = { apiKey: API_KEY, baseUrl: BASE_URL, fetch: stub };
      const transport = createHttpTransport(options);
      Object.assign(options, {
        apiKey: "changed-key",
        baseUrl: "https://other.example.com/api",
        fetch: answering(),
      });
      await transport.request(nudgeRequest());
      const { url, init } = sent(stub);
      expect(url).toBe(`${BASE_URL}/v2/Nudge/Send`);
      expect(init.headers).toMatchObject({ authorization: API_KEY });
    });
  });

  describe("options", () => {
    it.each<[string, unknown]>([
      ["an empty key", { apiKey: "" }],
      ["a blank key", { apiKey: "   " }],
      ["a missing key", { baseUrl: BASE_URL }],
      ["a numeric key", { apiKey: 42 }],
      ["a relative base URL", { apiKey: API_KEY, baseUrl: "/api" }],
      [
        "a base URL that is not http or https",
        { apiKey: API_KEY, baseUrl: "ftp://nudge.example.com/api" },
      ],
      ["an empty base URL", { apiKey: API_KEY, baseUrl: "" }],
      ["a null base URL", { apiKey: API_KEY, baseUrl: null }],
      ["null options", null],
      ["array options", []],
    ])("throws invalid synchronously for %s", (_label, options) => {
      expectInvalid(
        thrownBy(() => build(options)),
        "createHttpTransport",
      );
    });

    it("accepts an http root", async () => {
      const stub = answering();
      await transportOn(stub, "http://localhost:8080/api").request(
        nudgeRequest({ path: "v1/Lists" }),
      );
      expect(sent(stub).url).toBe("http://localhost:8080/api/v1/Lists");
    });

    it("calls nothing at construction", () => {
      const stub = answering();
      const globalStub = answering();
      vi.stubGlobal("fetch", globalStub);
      transportOn(stub);
      createHttpTransport({ apiKey: API_KEY });
      expect(stub).not.toHaveBeenCalled();
      expect(globalStub).not.toHaveBeenCalled();
    });
  });

  describe("silence", () => {
    it("makes one request per call and logs nothing", async () => {
      const spies = (["log", "info", "warn", "error", "debug"] as const).map(
        (name) => vi.spyOn(console, name).mockImplementation(() => undefined),
      );
      const stub = answering('{"HasErrors":true,"Code":500}', { status: 500 });
      const result = await transportOn(stub).request(nudgeRequest());
      expect(result.status).toBe(500);
      expect(stub).toHaveBeenCalledTimes(1);
      for (const spy of spies) {
        expect(spy).not.toHaveBeenCalled();
      }
    });
  });
});

describe("assertConnectionOptions", () => {
  it("accepts a key alone and a key with an http or https root", () => {
    expect(() =>
      assertConnectionOptions("createNudgeClient", API_KEY, undefined),
    ).not.toThrow();
    expect(() =>
      assertConnectionOptions("createNudgeClient", API_KEY, BASE_URL),
    ).not.toThrow();
    expect(() =>
      assertConnectionOptions(
        "createNudgeClient",
        API_KEY,
        "http://localhost:8080/api",
      ),
    ).not.toThrow();
  });

  it.each<[string, unknown, unknown]>([
    ["an undefined key", undefined, undefined],
    ["a numeric key", 42, undefined],
    ["a blank key", " \t ", undefined],
    ["a numeric root", API_KEY, 42],
    ["a null root", API_KEY, null],
    ["a relative root", API_KEY, "/api"],
    ["a root without a scheme", API_KEY, "nudge.example.com/api"],
    ["an ftp root", API_KEY, "ftp://nudge.example.com/api"],
    ["a javascript root", API_KEY, "javascript:alert(1)"],
  ])("throws invalid, naming the operation, for %s", (_label, key, root) => {
    expectInvalid(
      thrownBy(() => assertConnectionOptions("createNudgeClient", key, root)),
      "createNudgeClient",
    );
  });
});

describe("DEFAULT_BASE_URL", () => {
  it("is the production API root", () => {
    expect(DEFAULT_BASE_URL).toBe("https://app.nudge.net/api");
  });
});
