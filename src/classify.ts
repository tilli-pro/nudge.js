import { NudgeError, type NudgeErrorCode } from "./errors.js";

export type NudgeHttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface NudgeRequest {
  readonly operation: string;
  readonly method: NudgeHttpMethod;
  readonly path: string;
  readonly query?: Readonly<Record<string, string>>;
  readonly body?: unknown;
  readonly signal?: AbortSignal;
}

export interface NudgeResponse {
  readonly status: number;
  readonly headers: Headers;
  readonly body: unknown;
}

export interface NudgeTransport {
  request(request: NudgeRequest): Promise<NudgeResponse>;
}

export type NudgeRequestSpec = Omit<NudgeRequest, "signal">;

const ARRAY_OPERATIONS: ReadonlySet<string> = new Set([
  "preferences.get",
  "preferences.history",
]);

const DIGITS = /^\d+$/;

export function isRecord(
  value: unknown,
): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readField(body: unknown, name: string): unknown {
  if (!isRecord(body)) return;
  const wanted = name.toLowerCase();
  const key = Object.keys(body).find((k) => k.toLowerCase() === wanted);
  return key === undefined ? undefined : body[key];
}

function errorText(body: unknown): string | null {
  const value = readField(body, "error");
  return typeof value === "string" && value.length > 0 ? value : null;
}

function nudgeErrCodeOf(body: unknown): number | null {
  const value = readField(body, "errCode");
  return typeof value === "number" && Number.isInteger(value) && value !== 0
    ? value
    : null;
}

function serverMessageOf(body: unknown): string | null {
  const text = errorText(body);
  if (text !== null) return text;
  const errors = readField(body, "errors");
  if (
    Array.isArray(errors) &&
    errors.length > 0 &&
    errors.every((entry) => typeof entry === "string")
  ) {
    return errors.join(",");
  }
  const title = readField(body, "title");
  if (typeof title === "string" && title.length > 0) return title;
  if (typeof body === "string" && body.length > 0) return body;
  return null;
}

function codeFromNudgeCode(errCode: number): NudgeErrorCode {
  switch (errCode) {
    case 101:
    case 102:
      return "unauthorized";
    case 112:
    case 113:
    case 137:
    case 139:
      return "not-found";
    case 138:
      return "rejected";
    default:
      return "invalid";
  }
}

function codeFromText(text: string | null): NudgeErrorCode | null {
  if (text === null) return null;
  if (
    text.startsWith("API KEY not found") ||
    text.includes("is not whitelisted")
  ) {
    return "unauthorized";
  }
  if (text.startsWith("Nudge not found") || text === "Nudge is not active") {
    return "not-found";
  }
  if (text.startsWith("Rate limit exceeded")) return "rate-limited";
  if (
    text === "Not Enough Balance" ||
    text.startsWith("Notification is not allowed for this country code")
  ) {
    return "invalid";
  }
  return null;
}

function codeFromBody(body: unknown): NudgeErrorCode {
  const errCode = nudgeErrCodeOf(body);
  if (errCode !== null) return codeFromNudgeCode(errCode);
  return codeFromText(errorText(body)) ?? "invalid";
}

function build(
  operation: string,
  response: NudgeResponse,
  code: NudgeErrorCode,
  extra?: {
    readonly notificationLogId: string;
    readonly serverMessage: string | null;
  },
): NudgeError {
  const retryAfter = response.headers.get("retry-after");
  return new NudgeError({
    code,
    operation,
    status: response.status,
    nudgeErrCode: nudgeErrCodeOf(response.body),
    serverMessage: extra ? extra.serverMessage : serverMessageOf(response.body),
    notificationLogId: extra ? extra.notificationLogId : null,
    retryAfterSeconds:
      code === "rate-limited" && retryAfter !== null && DIGITS.test(retryAfter)
        ? Number(retryAfter)
        : null,
  });
}

function classifySuccess(
  operation: string,
  response: NudgeResponse,
): NudgeError | null {
  const { body } = response;
  const expected = ARRAY_OPERATIONS.has(operation)
    ? Array.isArray(body)
    : isRecord(body);
  if (!expected) return build(operation, response, "server");

  if (readField(body, "hasErrors") === true) {
    const code = readField(body, "code");
    return typeof code === "number" && code >= 500
      ? build(operation, response, "server")
      : build(operation, response, codeFromBody(body));
  }

  if (operation === "send") {
    const errors = readField(body, "errors");
    if (isRecord(errors)) {
      const [first] = Object.keys(errors);
      if (first !== undefined) {
        const entry = errors[first];
        return build(operation, response, "rejected", {
          notificationLogId: first,
          serverMessage:
            typeof entry === "string" && entry.length > 0 ? entry : null,
        });
      }
    }
  }
  return null;
}

export function classifyResponse(
  operation: string,
  response: NudgeResponse,
): NudgeError | null {
  const { status } = response;
  if (status >= 200 && status <= 299)
    return classifySuccess(operation, response);
  if (status === 401 || status === 403 || status === 498 || status === 499) {
    return build(operation, response, "unauthorized");
  }
  if (status === 409) return build(operation, response, "conflict");
  if (status === 429) return build(operation, response, "rate-limited");
  if (status >= 500) {
    const fromText =
      operation === "send" ? codeFromText(errorText(response.body)) : null;
    return build(operation, response, fromText ?? "server");
  }
  return build(operation, response, codeFromBody(response.body));
}

export function classifyNoResponse(
  operation: string,
  error: unknown,
  callerSignal: AbortSignal | undefined,
  timeoutSignal: AbortSignal,
): unknown {
  if (callerSignal?.aborted === true) return callerSignal.reason;
  return new NudgeError({
    code: timeoutSignal.aborted ? "timeout" : "network",
    operation,
    cause: error,
  });
}
