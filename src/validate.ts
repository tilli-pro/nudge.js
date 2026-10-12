import { isRecord } from "./classify.js";
import { NudgeError } from "./errors.js";
import { assertConnectionOptions } from "./http-transport.js";
import type {
  PreferenceLookup,
  PreferenceLookupOperation,
  PreferenceUpdate,
} from "./preferences.js";
import type { SendByTemplateInput } from "./send.js";
import type { StatsDetailsInput, StatsQuery } from "./stats.js";

export interface ClientOptionFields {
  readonly apiKey?: unknown;
  readonly baseUrl?: unknown;
  readonly timeoutMs?: unknown;
  readonly fetch?: unknown;
  readonly transport?: unknown;
}

const WALL_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/;
const DIGIT = /[0-9]/;
const MAX_REASON_LENGTH = 100;
const MAX_IDEMPOTENCY_KEY_LENGTH = 200;
const MAX_TOP = 100;

function fail(operation: string): never {
  throw new NudgeError({ code: "invalid", operation });
}

function requireRecord(
  value: unknown,
  operation: string,
): Readonly<Record<string, unknown>> {
  if (!isRecord(value)) return fail(operation);
  return value;
}

function isFilled(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function requireFilled(value: unknown, operation: string): void {
  if (!isFilled(value)) fail(operation);
}

function requireChannel(value: unknown, operation: string): void {
  if (value !== "email" && value !== "sms") fail(operation);
}

function requireIntegerInRange(
  value: unknown,
  min: number,
  max: number,
  operation: string,
): void {
  if (value === undefined) return;
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < min ||
    value > max
  ) {
    fail(operation);
  }
}

function requireWallTime(value: unknown, operation: string): void {
  if (value === undefined) return;
  if (typeof value !== "string" || !WALL_TIME.test(value)) fail(operation);
}

export function validateClientOptions(options: ClientOptionFields): void {
  const operation = "createNudgeClient";
  const fields = requireRecord(options, operation);
  assertConnectionOptions(operation, fields.apiKey, fields.baseUrl);
  const { timeoutMs } = fields;
  if (
    timeoutMs !== undefined &&
    !(
      typeof timeoutMs === "number" &&
      Number.isInteger(timeoutMs) &&
      timeoutMs > 0
    )
  ) {
    fail(operation);
  }
  if (fields.fetch !== undefined && fields.transport !== undefined) {
    fail(operation);
  }
}

function requireMergeTags(value: unknown, operation: string): void {
  const tags = requireRecord(value, operation);
  const seen = new Set<string>();
  for (const [name, tagValue] of Object.entries(tags)) {
    if (!isFilled(name) || name.includes("%") || typeof tagValue !== "string") {
      fail(operation);
    }
    const lowered = name.toLowerCase();
    if (seen.has(lowered)) fail(operation);
    seen.add(lowered);
  }
}

export function validateSendInput(input: SendByTemplateInput): void {
  const operation = "send";
  const fields = requireRecord(input, operation);
  requireFilled(fields.externalRef, operation);
  requireChannel(fields.channel, operation);
  const to = requireRecord(fields.to, operation);
  const address = fields.channel === "email" ? to.email : to.phone;
  if (!isFilled(address) || address.includes(",")) fail(operation);
  if (fields.recipientId !== undefined) {
    requireFilled(fields.recipientId, operation);
  }
  requireMergeTags(fields.mergeTags, operation);
  const key = fields.idempotencyKey;
  if (key !== undefined) {
    if (!isFilled(key) || key.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
      fail(operation);
    }
  }
}

export function validateStatsQuery(query: StatsQuery): void {
  const operation = "stats.list";
  const fields = requireRecord(query, operation);
  requireChannel(fields.channel, operation);
  requireFilled(fields.timeZone, operation);
  requireIntegerInRange(fields.top, 1, MAX_TOP, operation);
  requireIntegerInRange(fields.skip, 0, Number.MAX_SAFE_INTEGER, operation);
  requireIntegerInRange(fields.status, 0, Number.MAX_SAFE_INTEGER, operation);
  requireWallTime(fields.from, operation);
  requireWallTime(fields.to, operation);
  const { phone } = fields;
  if (
    phone !== undefined &&
    !(typeof phone === "string" && DIGIT.test(phone))
  ) {
    fail(operation);
  }
}

export function validateStatsDetails(input: StatsDetailsInput): void {
  const operation = "stats.details";
  const fields = requireRecord(input, operation);
  requireChannel(fields.channel, operation);
  requireFilled(fields.notificationLogId, operation);
}

export function validatePreferenceLookup(
  operation: PreferenceLookupOperation,
  lookup: PreferenceLookup,
): void {
  const fields = requireRecord(lookup, operation);
  requireFilled(fields.recipientId, operation);
}

export function validatePreferenceUpdate(update: PreferenceUpdate): void {
  const operation = "preferences.update";
  const fields = requireRecord(update, operation);
  if (
    !(
      isFilled(fields.recipientId) ||
      isFilled(fields.email) ||
      isFilled(fields.phone)
    )
  ) {
    fail(operation);
  }
  const { changes } = fields;
  if (!Array.isArray(changes) || changes.length === 0) fail(operation);
  for (const change of changes as unknown[]) {
    const { unsubscribeReason } = requireRecord(change, operation);
    if (
      unsubscribeReason !== undefined &&
      !(
        typeof unsubscribeReason === "string" &&
        unsubscribeReason.length <= MAX_REASON_LENGTH
      )
    ) {
      fail(operation);
    }
  }
}
