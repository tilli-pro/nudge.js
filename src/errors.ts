export type NudgeErrorCode =
  | "unauthorized"
  | "not-found"
  | "invalid"
  | "rejected"
  | "conflict"
  | "rate-limited"
  | "server"
  | "network"
  | "timeout";

const NUDGE_ERROR_BRAND: unique symbol = Symbol.for(
  "@tilli.dev/nudge.js:NudgeError",
);

const RETRYABLE_CODES: ReadonlySet<NudgeErrorCode> = new Set<NudgeErrorCode>([
  "rate-limited",
  "server",
  "network",
  "timeout",
]);

export class NudgeError extends Error {
  readonly name = "NudgeError";
  readonly code: NudgeErrorCode;
  readonly operation: string;
  readonly status: number | null;
  readonly retryable: boolean;
  readonly retryAfterSeconds: number | null;
  readonly nudgeErrCode: number | null;
  readonly notificationLogId: string | null;
  declare readonly serverMessage: string | null;

  constructor(init: {
    readonly code: NudgeErrorCode;
    readonly operation: string;
    readonly status?: number | null;
    readonly retryAfterSeconds?: number | null;
    readonly nudgeErrCode?: number | null;
    readonly notificationLogId?: string | null;
    readonly serverMessage?: string | null;
    readonly cause?: unknown;
  }) {
    const status = init.status ?? null;
    const message = `nudge ${init.operation}: ${init.code}${
      status === null ? "" : ` (HTTP ${status})`
    }`;
    if (init.cause === undefined) {
      super(message);
    } else {
      super(message, { cause: init.cause });
    }
    this.code = init.code;
    this.operation = init.operation;
    this.status = status;
    this.retryable = RETRYABLE_CODES.has(init.code);
    this.retryAfterSeconds = init.retryAfterSeconds ?? null;
    this.nudgeErrCode = init.nudgeErrCode ?? null;
    this.notificationLogId = init.notificationLogId ?? null;
    Object.defineProperty(this, "serverMessage", {
      value: init.serverMessage ?? null,
      enumerable: false,
      writable: false,
      configurable: false,
    });
  }
}

Object.defineProperty(NudgeError.prototype, NUDGE_ERROR_BRAND, {
  value: true,
});

export function isNudgeError(value: unknown): value is NudgeError {
  if (
    value === null ||
    (typeof value !== "object" && typeof value !== "function")
  ) {
    return false;
  }
  return (value as Record<symbol, unknown>)[NUDGE_ERROR_BRAND] === true;
}
