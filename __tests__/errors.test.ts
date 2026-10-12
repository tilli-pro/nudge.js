import { describe, expect, it } from "vitest";
import {
  isNudgeError,
  NudgeError,
  type NudgeErrorCode,
} from "../src/errors.js";

const RETRYABLE: readonly [NudgeErrorCode, boolean][] = [
  ["unauthorized", false],
  ["not-found", false],
  ["invalid", false],
  ["rejected", false],
  ["conflict", false],
  ["rate-limited", true],
  ["server", true],
  ["network", true],
  ["timeout", true],
];

const BRAND = Symbol.for("@tilli.dev/nudge.js:NudgeError");

describe("NudgeError", () => {
  it("defaults every optional field to null", () => {
    const error = new NudgeError({ code: "invalid", operation: "send" });
    expect(error.code).toBe("invalid");
    expect(error.operation).toBe("send");
    expect(error.status).toBeNull();
    expect(error.retryAfterSeconds).toBeNull();
    expect(error.nudgeErrCode).toBeNull();
    expect(error.notificationLogId).toBeNull();
    expect(error.serverMessage).toBeNull();
  });

  it.each(RETRYABLE)("marks %s retryable: %s", (code, retryable) => {
    expect(new NudgeError({ code, operation: "send" }).retryable).toBe(
      retryable,
    );
  });

  it("ignores a retryable passed through a cast", () => {
    const init = {
      code: "invalid",
      operation: "send",
      retryable: true,
    } as unknown as ConstructorParameters<typeof NudgeError>[0];
    expect(new NudgeError(init).retryable).toBe(false);
    const other = {
      code: "server",
      operation: "send",
      retryable: false,
    } as unknown as ConstructorParameters<typeof NudgeError>[0];
    expect(new NudgeError(other).retryable).toBe(true);
  });

  it("formats the message with and without an HTTP status", () => {
    expect(
      new NudgeError({ code: "rate-limited", operation: "send", status: 429 })
        .message,
    ).toBe("nudge send: rate-limited (HTTP 429)");
    expect(
      new NudgeError({ code: "timeout", operation: "stats.list" }).message,
    ).toBe("nudge stats.list: timeout");
  });

  it("keeps the server message off the enumerable surface", () => {
    const error = new NudgeError({
      code: "invalid",
      operation: "send",
      status: 400,
      serverMessage: "secret server text",
    });
    expect(error.serverMessage).toBe("secret server text");
    expect(Object.getOwnPropertyDescriptor(error, "serverMessage")).toEqual({
      value: "secret server text",
      writable: false,
      enumerable: false,
      configurable: false,
    });
    expect(Object.keys(error)).not.toContain("serverMessage");
    expect(JSON.stringify(error)).not.toContain("secret server text");
  });

  it("has exactly the documented enumerable keys", () => {
    const error = new NudgeError({
      code: "rejected",
      operation: "send",
      status: 200,
      retryAfterSeconds: 3,
      nudgeErrCode: 138,
      notificationLogId: "log-1",
      serverMessage: "text",
      cause: new Error("inner"),
    });
    expect(Object.keys(error).sort()).toEqual(
      [
        "name",
        "code",
        "operation",
        "status",
        "retryable",
        "retryAfterSeconds",
        "nudgeErrCode",
        "notificationLogId",
      ].sort(),
    );
  });

  it("passes cause to Error only when given", () => {
    const without = new NudgeError({ code: "network", operation: "send" });
    expect(Object.hasOwn(without, "cause")).toBe(false);
    const undef = new NudgeError({
      code: "network",
      operation: "send",
      cause: undefined,
    });
    expect(Object.hasOwn(undef, "cause")).toBe(false);
    const inner = new Error("inner");
    const withCause = new NudgeError({
      code: "network",
      operation: "send",
      cause: inner,
    });
    expect(withCause.cause).toBe(inner);
    const withNull = new NudgeError({
      code: "network",
      operation: "send",
      cause: null,
    });
    expect(Object.hasOwn(withNull, "cause")).toBe(true);
    expect(withNull.cause).toBeNull();
  });

  it("is an Error named NudgeError", () => {
    const error = new NudgeError({ code: "server", operation: "send" });
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(NudgeError);
    expect(error.name).toBe("NudgeError");
  });
});

describe("isNudgeError", () => {
  it("recognises an instance", () => {
    expect(
      isNudgeError(new NudgeError({ code: "invalid", operation: "send" })),
    ).toBe(true);
  });

  it("recognises a copy branded by another package copy", () => {
    const copy = Object.create(null) as object;
    Object.defineProperty(copy, BRAND, { value: true });
    expect(isNudgeError(copy)).toBe(true);
  });

  it("rejects look-alikes", () => {
    expect(isNudgeError(new Error("x"))).toBe(false);
    expect(isNudgeError({ name: "NudgeError", code: "invalid" })).toBe(false);
    expect(isNudgeError(null)).toBe(false);
    expect(isNudgeError("NudgeError")).toBe(false);
    expect(isNudgeError(undefined)).toBe(false);
    const wrongValue = Object.create(null) as object;
    Object.defineProperty(wrongValue, BRAND, { value: "yes" });
    expect(isNudgeError(wrongValue)).toBe(false);
  });
});
