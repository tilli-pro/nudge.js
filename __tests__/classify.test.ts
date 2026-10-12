import { describe, expect, it } from "vitest";
import {
  classifyNoResponse,
  classifyResponse,
  type NudgeResponse,
  readField,
} from "../src/classify.js";
import { NudgeError, type NudgeErrorCode } from "../src/errors.js";
import {
  FIXTURE_OUTCOMES,
  type Fixture,
  fixtureResponse,
  loadFixtures,
  placeholderId,
} from "./helpers/fixtures.js";

function response(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): NudgeResponse {
  return { status, headers: new Headers(headers), body };
}

function failure(operation: string, res: NudgeResponse): NudgeError {
  const error = classifyResponse(operation, res);
  if (error === null) {
    throw new Error(`expected a failure for ${operation} (HTTP ${res.status})`);
  }
  return error;
}

const OK_BODY = {
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

function flattened(code: number, text: string): Record<string, unknown> {
  return { HasErrors: true, Code: code, Error: text };
}

function envelope(errCode: number, text: string): Record<string, unknown> {
  return {
    code: 400,
    errCode,
    errors: [text],
    hasErrors: true,
    errorGuid: placeholderId(1),
  };
}

describe("readField", () => {
  it("reads keys ignoring case", () => {
    expect(readField({ ErrCode: 112 }, "errCode")).toBe(112);
    expect(readField({ errcode: 112 }, "ERRCODE")).toBe(112);
    expect(readField({ errCode: 112 }, "ErrCode")).toBe(112);
  });

  it("takes the first matching key", () => {
    expect(readField({ Error: "first", error: "second" }, "error")).toBe(
      "first",
    );
    expect(readField({ other: 1, error: "second", Error: "x" }, "ERROR")).toBe(
      "second",
    );
  });

  it("reads nothing from arrays, null and text", () => {
    for (const body of [[], [{ error: "x" }], null, undefined, "error", 5]) {
      expect(readField(body, "error")).toBeUndefined();
    }
    expect(readField({ other: 1 }, "error")).toBeUndefined();
  });
});

describe("classifyResponse", () => {
  it("never throws, whatever the body", () => {
    const bodies: unknown[] = [
      undefined,
      null,
      0,
      "",
      "text",
      [],
      [1],
      {},
      { errors: 5 },
      { errors: [] },
      { errors: { a: 1 } },
      { errCode: "x" },
      { errCode: 1.5 },
      { hasErrors: "true" },
      { hasErrors: true, code: "500" },
      Object.create(null),
    ];
    for (const operation of ["send", "preferences.get", "stats.list"]) {
      for (const status of [100, 200, 302, 400, 429, 500]) {
        for (const body of bodies) {
          expect(() =>
            classifyResponse(operation, response(status, body)),
          ).not.toThrow();
        }
      }
    }
  });
});

describe("2xx", () => {
  it("succeeds on a clean flattened send body", () => {
    expect(classifyResponse("send", response(200, OK_BODY))).toBeNull();
  });

  it("succeeds on an envelope with hasErrors false", () => {
    const body = {
      data: { pageData: [], totalCount: 0, errors: 0 },
      code: 200,
      errCode: 0,
      errors: [],
      hasErrors: false,
      errorGuid: null,
    };
    expect(classifyResponse("stats.list", response(200, body))).toBeNull();
  });

  it("succeeds on an array for preferences.get and preferences.history", () => {
    expect(classifyResponse("preferences.get", response(200, []))).toBeNull();
    expect(
      classifyResponse("preferences.history", response(200, [{}])),
    ).toBeNull();
  });

  it("answers server when the body is not the kind the operation reads", () => {
    const cases: [string, unknown][] = [
      ["send", "accepted"],
      ["send", null],
      ["send", []],
      ["stats.list", []],
      ["preferences.get", {}],
      ["preferences.history", {}],
    ];
    for (const [operation, body] of cases) {
      const error = failure(operation, response(200, body));
      expect(error.code).toBe("server");
      expect(error.status).toBe(200);
      expect(error.retryable).toBe(true);
    }
  });

  it("answers server for hasErrors with code 500 or more", () => {
    const filter = failure(
      "send",
      response(200, {
        code: 500,
        errCode: 0,
        errors: ["Server error. Please try again later."],
        hasErrors: true,
        errorGuid: placeholderId(1),
      }),
    );
    expect(filter.code).toBe("server");
    expect(filter.status).toBe(200);
    expect(filter.nudgeErrCode).toBeNull();
    expect(filter.serverMessage).toBe("Server error. Please try again later.");
    expect(filter.retryable).toBe(true);

    const flat = failure("send", response(200, { HasErrors: true, Code: 503 }));
    expect(flat.code).toBe("server");
    expect(flat.serverMessage).toBeNull();
  });

  it("goes to Nudge's code for hasErrors below 500", () => {
    const byCode = failure(
      "send",
      response(200, envelope(138, "unsubscribed")),
    );
    expect(byCode.code).toBe("rejected");
    expect(byCode.status).toBe(200);
    expect(byCode.nudgeErrCode).toBe(138);

    const byText = failure(
      "send",
      response(200, flattened(400, "Nudge is not active")),
    );
    expect(byText.code).toBe("not-found");

    const neither = failure(
      "send",
      response(200, { HasErrors: true, Code: 400 }),
    );
    expect(neither.code).toBe("invalid");
    expect(neither.status).toBe(200);
  });

  it("rejects a send whose Errors map has an entry", () => {
    const first = placeholderId(1);
    const second = placeholderId(2);
    const error = failure(
      "send",
      response(200, {
        ...OK_BODY,
        NotificationLogId: first,
        Errors: { [first]: "Mailbox unavailable", [second]: "Other" },
        Statuses: { [first]: 3 },
      }),
    );
    expect(error.code).toBe("rejected");
    expect(error.status).toBe(200);
    expect(error.notificationLogId).toBe(first);
    expect(error.serverMessage).toBe("Mailbox unavailable");
    expect(error.nudgeErrCode).toBeNull();
    expect(error.retryable).toBe(false);

    const noText = failure(
      "send",
      response(200, { ...OK_BODY, Errors: { [first]: 3 } }),
    );
    expect(noText.notificationLogId).toBe(first);
    expect(noText.serverMessage).toBeNull();
  });

  it("ignores an empty or null Errors map", () => {
    for (const errors of [{}, null, [], undefined]) {
      expect(
        classifyResponse("send", response(200, { ...OK_BODY, Errors: errors })),
      ).toBeNull();
    }
  });

  it("reads an Errors map only for send", () => {
    const body = {
      data: { id: placeholderId(1), mergeTags: null },
      code: 200,
      errCode: 0,
      errors: { [placeholderId(1)]: "not a send" },
      hasErrors: false,
      errorGuid: null,
    };
    expect(classifyResponse("stats.details", response(200, body))).toBeNull();
  });
});

describe("status", () => {
  it.each([401, 403, 498, 499])(
    "answers unauthorized for %i whatever the body",
    (status) => {
      const error = failure("send", response(status, envelope(137, "x")));
      expect(error.code).toBe("unauthorized");
      expect(error.status).toBe(status);
      expect(error.nudgeErrCode).toBe(137);
      expect(error.retryable).toBe(false);
    },
  );

  it("answers conflict for 409", () => {
    const error = failure("send", response(409, null));
    expect(error.code).toBe("conflict");
    expect(error.status).toBe(409);
    expect(error.retryable).toBe(false);
  });

  it("answers rate-limited for 429 with Retry-After seconds", () => {
    const seconds = failure(
      "send",
      response(429, null, { "Retry-After": "30" }),
    );
    expect(seconds.code).toBe("rate-limited");
    expect(seconds.status).toBe(429);
    expect(seconds.retryAfterSeconds).toBe(30);
    expect(seconds.retryable).toBe(true);

    const date = failure(
      "send",
      response(429, null, { "retry-after": "Wed, 21 Oct 2026 07:28:00 GMT" }),
    );
    expect(date.code).toBe("rate-limited");
    expect(date.retryAfterSeconds).toBeNull();

    const absent = failure("send", response(429, null));
    expect(absent.retryAfterSeconds).toBeNull();
  });

  it("keeps Retry-After only for rate-limited errors", () => {
    const server = failure(
      "send",
      response(503, null, { "retry-after": "30" }),
    );
    expect(server.code).toBe("server");
    expect(server.retryAfterSeconds).toBeNull();

    const byText = failure(
      "send",
      response(400, flattened(400, "Rate limit exceeded (1 per 60 min)."), {
        "retry-after": "5",
      }),
    );
    expect(byText.code).toBe("rate-limited");
    expect(byText.retryAfterSeconds).toBe(5);
  });

  it("answers server for 5xx", () => {
    const error = failure("send", response(502, "Bad Gateway"));
    expect(error.code).toBe("server");
    expect(error.status).toBe(502);
    expect(error.serverMessage).toBe("Bad Gateway");
    expect(error.retryable).toBe(true);
  });

  it("classifies a 5xx send by its fixed text first", () => {
    const balance = failure(
      "send",
      response(500, flattened(500, "Not Enough Balance")),
    );
    expect(balance.code).toBe("invalid");
    expect(balance.status).toBe(500);
    expect(balance.retryable).toBe(false);

    const listed = failure(
      "send",
      response(
        500,
        flattened(500, "Email: recipient-1@example.com is not whitelisted."),
      ),
    );
    expect(listed.code).toBe("unauthorized");
  });

  it("keeps a 5xx outside send as server even with a fixed text", () => {
    const error = failure(
      "stats.list",
      response(500, flattened(500, "Not Enough Balance")),
    );
    expect(error.code).toBe("server");
  });
});

describe("Nudge's code and texts", () => {
  const ERR_CODES: readonly [number, NudgeErrorCode][] = [
    [101, "unauthorized"],
    [102, "unauthorized"],
    [112, "not-found"],
    [113, "not-found"],
    [137, "not-found"],
    [139, "not-found"],
    [138, "rejected"],
    [1006, "invalid"],
  ];

  it.each(ERR_CODES)("maps errCode %i to %s", (errCode, code) => {
    const error = failure(
      "stats.details",
      response(400, envelope(errCode, "x")),
    );
    expect(error.code).toBe(code);
    expect(error.status).toBe(400);
    expect(error.nudgeErrCode).toBe(errCode);
  });

  it("prefers the code to the text", () => {
    const error = failure(
      "send",
      response(400, {
        HasErrors: true,
        Code: 400,
        ErrCode: 102,
        Error: "Nudge is not active",
      }),
    );
    expect(error.code).toBe("unauthorized");
  });

  it("ignores errCode 0", () => {
    const zero = failure(
      "send",
      response(400, { ...flattened(400, "Nudge not found for x"), errCode: 0 }),
    );
    expect(zero.nudgeErrCode).toBeNull();
    expect(zero.code).toBe("not-found");

    for (const errCode of ["102", 1.5, null]) {
      const error = failure(
        "send",
        response(400, { ...flattened(400, "Not Enough Balance"), errCode }),
      );
      expect(error.nudgeErrCode).toBeNull();
      expect(error.code).toBe("invalid");
    }
  });

  const TEXTS: readonly [string, NudgeErrorCode][] = [
    ["API KEY not found or Invalid API KEY", "unauthorized"],
    ["Ip address 192.0.2.10 is not whitelisted", "unauthorized"],
    [
      "Nudge not found for the given nudgeExternalRef and channel.",
      "not-found",
    ],
    ["Nudge is not active", "not-found"],
    [
      "Rate limit exceeded (1 per 60 min). Retry after 2026-10-11T10:00:00Z.",
      "rate-limited",
    ],
    ["Not Enough Balance", "invalid"],
    ["Notification is not allowed for this country code +1555", "invalid"],
  ];

  it.each(TEXTS)("maps the text %s to %s", (text, code) => {
    const error = failure("send", response(400, flattened(400, text)));
    expect(error.code).toBe(code);
    expect(error.nudgeErrCode).toBeNull();
    expect(error.serverMessage).toBe(text);
  });

  it("matches the fixed texts exactly and case-sensitively", () => {
    for (const text of [
      "nudge not found",
      "Nudge is not active.",
      "Nudge is not active now",
      "Not Enough Balance now",
      "rate limit exceeded",
      "api key not found",
    ]) {
      expect(failure("send", response(400, flattened(400, text))).code).toBe(
        "invalid",
      );
    }
  });

  it("falls back to invalid", () => {
    expect(failure("send", response(404, null)).code).toBe("invalid");
    expect(failure("send", response(420, null)).code).toBe("invalid");
    const problem = failure(
      "send",
      response(
        400,
        {
          type: "https://tools.ietf.org/html/rfc9110#section-15.5.1",
          title: "One or more validation errors occurred.",
          status: 400,
          errors: { requestV2: ["The requestV2 field is required."] },
        },
        { "content-type": "application/problem+json; charset=utf-8" },
      ),
    );
    expect(problem.code).toBe("invalid");
    expect(problem.nudgeErrCode).toBeNull();
  });

  it("reads PascalCase and camelCase alike", () => {
    const pascal = failure(
      "stats.details",
      response(400, { HasErrors: true, Code: 400, ErrCode: 112 }),
    );
    const camel = failure(
      "stats.details",
      response(400, { hasErrors: true, code: 400, errCode: 112 }),
    );
    expect(pascal.code).toBe("not-found");
    expect(camel.code).toBe("not-found");
    expect(pascal.nudgeErrCode).toBe(112);
    expect(camel.nudgeErrCode).toBe(112);
  });
});

describe("serverMessage", () => {
  it("joins an errors array with a comma", () => {
    const error = failure(
      "stats.details",
      response(400, { errCode: 1006, errors: ["first", "second"] }),
    );
    expect(error.serverMessage).toBe("first,second");
  });

  it("prefers the Error text to an errors array", () => {
    const error = failure(
      "send",
      response(400, { Error: "the text", errors: ["ignored"] }),
    );
    expect(error.serverMessage).toBe("the text");
  });

  it("uses a problem title", () => {
    const error = failure(
      "send",
      response(400, { title: "One or more validation errors occurred." }),
    );
    expect(error.serverMessage).toBe("One or more validation errors occurred.");
  });

  it("skips an errors array that holds a non-string", () => {
    const error = failure(
      "send",
      response(400, { errors: ["a", 1], title: "The title" }),
    );
    expect(error.serverMessage).toBe("The title");
  });

  it("is null when the body says nothing", () => {
    for (const body of [null, "", {}, [], { Error: "" }, { errors: [] }]) {
      expect(failure("send", response(400, body)).serverMessage).toBeNull();
    }
  });
});

describe("every fixture", () => {
  it("has an expected outcome, and every outcome a fixture", () => {
    const names = loadFixtures().map((fixture) => fixture.name);
    expect(names).toHaveLength(27);
    expect(names).toEqual(Object.keys(FIXTURE_OUTCOMES).sort());
  });

  it.each(loadFixtures().map((f): [string, Fixture] => [f.name, f]))(
    "%s classifies as recorded in FIXTURE_OUTCOMES",
    (name, fixture) => {
      const outcome = FIXTURE_OUTCOMES[name];
      const error = classifyResponse(
        fixture.operation,
        fixtureResponse(fixture),
      );
      if (outcome === undefined) throw new Error(`no outcome for ${name}`);
      if (outcome.ok) {
        expect(error).toBeNull();
        return;
      }
      expect(error).toBeInstanceOf(NudgeError);
      expect({
        code: error?.code,
        status: error?.status,
        nudgeErrCode: error?.nudgeErrCode,
        notificationLogId: error?.notificationLogId,
      }).toEqual({
        code: outcome.code,
        status: outcome.status,
        nudgeErrCode: outcome.nudgeErrCode,
        notificationLogId: outcome.notificationLogId,
      });
    },
  );
});

describe("classifyNoResponse", () => {
  const fired = (): AbortSignal => {
    const controller = new AbortController();
    controller.abort();
    return controller.signal;
  };
  const idle = (): AbortSignal => new AbortController().signal;

  it("re-throws the caller's reason untouched", () => {
    const reason = new Error("stop");
    const controller = new AbortController();
    controller.abort(reason);
    const result = classifyNoResponse(
      "send",
      new Error("fetch failed"),
      controller.signal,
      idle(),
    );
    expect(result).toBe(reason);
  });

  it("tests the caller's signal before the timeout", () => {
    const reason = new Error("stop");
    const controller = new AbortController();
    controller.abort(reason);
    const result = classifyNoResponse(
      "send",
      new Error("aborted"),
      controller.signal,
      fired(),
    );
    expect(result).toBe(reason);
  });

  it("answers timeout when the timeout signal fired", () => {
    const cause = new Error("aborted");
    for (const callerSignal of [undefined, idle()]) {
      const result = classifyNoResponse(
        "stats.list",
        cause,
        callerSignal,
        fired(),
      );
      expect(result).toBeInstanceOf(NudgeError);
      const error = result as NudgeError;
      expect(error.code).toBe("timeout");
      expect(error.operation).toBe("stats.list");
      expect(error.status).toBeNull();
      expect(error.retryable).toBe(true);
      expect(error.cause).toBe(cause);
    }
  });

  it("answers network otherwise", () => {
    const cause = new TypeError("fetch failed");
    const result = classifyNoResponse("send", cause, idle(), idle());
    expect(result).toBeInstanceOf(NudgeError);
    const error = result as NudgeError;
    expect(error.code).toBe("network");
    expect(error.status).toBeNull();
    expect(error.retryable).toBe(true);
    expect(error.cause).toBe(cause);
  });
});
