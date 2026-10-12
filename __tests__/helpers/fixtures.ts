import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { NudgeHttpMethod, NudgeResponse } from "../../src/classify.js";
import type { NudgeErrorCode } from "../../src/errors.js";

export interface Fixture {
  readonly name: string;
  readonly operation: string;
  readonly origin: "derived" | "recorded";
  readonly source: string;
  readonly request: {
    readonly method: NudgeHttpMethod;
    readonly path: string;
    readonly query?: Readonly<Record<string, string>>;
    readonly body?: unknown;
  };
  readonly response: {
    readonly status: number;
    readonly headers: Readonly<Record<string, string>>;
    readonly body: unknown;
  };
}

export type FixtureOutcome =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly code: NudgeErrorCode;
      readonly status: number;
      readonly nudgeErrCode: number | null;
      readonly notificationLogId: string | null;
    };

export const FIXTURES_DIR: string = resolve(
  import.meta.dirname,
  "..",
  "..",
  "fixtures",
);

export const PERMANENTLY_DERIVED: readonly string[] = [
  "send.all-unsubscribed",
  "send.exception-filter",
  "send.inactive-nudge",
  "send.ip-not-allowed",
  "send.not-enough-balance",
  "send.rate-limited-account",
  "send.rate-limited-recipient",
  "send.recipient-failed",
  "send.server-error",
  "stats.details.null-merge-tags",
];

export function placeholderId(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

const OK: FixtureOutcome = { ok: true };

function fails(
  code: NudgeErrorCode,
  status: number,
  nudgeErrCode: number | null = null,
  notificationLogId: string | null = null,
): FixtureOutcome {
  return { ok: false, code, status, nudgeErrCode, notificationLogId };
}

export const FIXTURE_OUTCOMES: Readonly<Record<string, FixtureOutcome>> = {
  "preferences.get.found": OK,
  "preferences.history.found": OK,
  "preferences.update.accepted": OK,
  "preferences.update.refused": fails("invalid", 400, 1006),
  "send.accepted": OK,
  "send.all-unsubscribed": fails("invalid", 400),
  "send.duplicate-tag": fails("invalid", 400),
  "send.exception-filter": fails("server", 200),
  "send.inactive-nudge": fails("not-found", 400),
  "send.ip-not-allowed": fails("unauthorized", 400, 102),
  "send.link-tag-refused": fails("invalid", 400),
  "send.missing-merge-tag": fails("invalid", 400),
  "send.not-enough-balance": fails("invalid", 500),
  "send.problem-details": fails("invalid", 400),
  "send.rate-limited-account": fails("rate-limited", 429),
  "send.rate-limited-recipient": fails("rate-limited", 429),
  "send.recipient-failed": fails("rejected", 200, null, placeholderId(1)),
  "send.replay": OK,
  "send.server-error": fails("server", 500),
  "send.sms-accepted": OK,
  "send.sms-number-refused": fails("invalid", 400),
  "send.unauthorized-key": fails("unauthorized", 401),
  "send.unknown-ref": fails("not-found", 400),
  "stats.details.merge-tags": OK,
  "stats.details.null-merge-tags": OK,
  "stats.details.unknown-id": fails("not-found", 400, 137),
  "stats.list.window": OK,
};

export function loadFixture(name: string): Fixture {
  let text: string;
  try {
    text = readFileSync(resolve(FIXTURES_DIR, `${name}.json`), "utf8");
  } catch {
    throw new Error(`no fixture ${name}`);
  }
  const parsed = JSON.parse(text) as Omit<Fixture, "name" | "operation">;
  return { name, operation: name.slice(0, name.lastIndexOf(".")), ...parsed };
}

export function loadFixtures(): readonly Fixture[] {
  return readdirSync(FIXTURES_DIR)
    .filter((file) => file.endsWith(".json"))
    .map((file) => file.slice(0, -".json".length))
    .sort()
    .map((name) => loadFixture(name));
}

export function fixtureResponse(fixture: Fixture): NudgeResponse {
  return {
    status: fixture.response.status,
    headers: new Headers(fixture.response.headers),
    body: fixture.response.body,
  };
}

export function fixtureResponseText(fixture: Fixture): string {
  const { body } = fixture.response;
  if (body === null) return "";
  if (typeof body === "string") return body;
  return JSON.stringify(body);
}

export const HYGIENE_PATTERNS: {
  readonly guid: RegExp;
  readonly placeholderGuid: RegExp;
  readonly email: RegExp;
  readonly phone: RegExp;
  readonly authorization: RegExp;
} = {
  guid: /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
  placeholderGuid: /^00000000-0000-4000-8000-\d{12}$/,
  email: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
  phone: /(?<![\dA-Za-z])\+?\d{10,15}(?![\dA-Za-z])/g,
  authorization: /authorization["'\x60]?\s*:\s*["'\x60]/i,
};

export interface HygieneViolations {
  readonly guids: readonly string[];
  readonly emails: readonly string[];
  readonly phones: readonly string[];
  readonly authorization: boolean;
}

export function findHygieneViolations(text: string): HygieneViolations {
  const { guid, placeholderGuid, email, phone, authorization } =
    HYGIENE_PATTERNS;
  const guids = (text.match(guid) ?? []).filter(
    (match) => !placeholderGuid.test(match),
  );
  const emails = (text.match(email) ?? []).filter(
    (match) => !match.endsWith("@example.com"),
  );
  const phones = (text.replace(guid, " ").match(phone) ?? []).filter(
    (match) => !(match.startsWith("+1555") || match.startsWith("1555")),
  );
  return { guids, emails, phones, authorization: authorization.test(text) };
}
