import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const README = readFileSync(
  resolve(import.meta.dirname, "..", "README.md"),
  "utf8",
);

function section(heading: string): string {
  const found = README.split(/^## /m)
    .slice(1)
    .find((part) => part.startsWith(`${heading}\n`));
  if (found === undefined) {
    throw new Error(`README has no section ${heading}`);
  }
  return found;
}

function flat(text: string): string {
  return text.replace(/\s+/g, " ");
}

describe("README.md", () => {
  it("has its sections in order", () => {
    const headings = [...README.matchAll(/^## (.+)$/gm)].map(
      (match) => match[1],
    );
    expect(headings).toEqual([
      "Install",
      "Client",
      "Send",
      "Idempotency",
      "Stats",
      "Preferences",
      "Errors",
      "Testing with the fake transport",
      "Migrating from 0.1.0",
      "Security notes",
      "Licence",
    ]);
  });

  it("names every runtime export", () => {
    for (const name of [
      "createNudgeClient",
      "createHttpTransport",
      "createFakeTransport",
      "isNudgeError",
      "NudgeError",
      "DEFAULT_BASE_URL",
    ]) {
      expect(README, name).toContain(name);
    }
  });

  it("tabulates the nine error codes with their retryable flag", () => {
    const errors = section("Errors");
    const codes: readonly (readonly [string, "yes" | "no"])[] = [
      ["unauthorized", "no"],
      ["not-found", "no"],
      ["invalid", "no"],
      ["rejected", "no"],
      ["conflict", "no"],
      ["rate-limited", "yes"],
      ["server", "yes"],
      ["network", "yes"],
      ["timeout", "yes"],
    ];
    for (const [code, retryable] of codes) {
      const row = new RegExp(
        `^\\| \`${code}\` \\|[^|]+\\| ${retryable} \\|$`,
        "m",
      );
      expect(errors, code).toMatch(row);
    }
  });

  it("states each idempotency rule", () => {
    const text = flat(section("Idempotency"));
    for (const phrase of [
      "The caller generates the key; the SDK never does",
      "across every ref and channel",
      "unique account-wide",
      "survives a database reset",
      "five minutes",
      "only after a successful send",
      "not durable deduplication",
      "keeps its own record of what it sent",
      "same key",
      "`retryable`",
    ]) {
      expect(text, phrase).toContain(phrase);
    }
  });

  it("says what Nudge does with the end of a stats window", () => {
    const text = flat(section("Stats"));
    expect(text).toContain("wall time");
    expect(text).toContain("to + 24 hours");
    expect(text).toContain("entries.length < top");
  });

  it("documents the API roots and the default timeout", () => {
    const text = flat(section("Client"));
    for (const root of [
      "https://app.nudge.net/api",
      "https://staging.nudge.net/api",
      "https://qa.nudge.net/api",
    ]) {
      expect(text, root).toContain(root);
    }
    expect(text).toContain("10 seconds");
  });

  it("migrates in ten numbered points, in order", () => {
    const migration = section("Migrating from 0.1.0");
    const list = migration.slice(migration.search(/^1\. /m));
    expect(list.match(/^\d+\. /gm)).toHaveLength(10);
    let from = 0;
    for (const fragment of [
      "one client per API key",
      "ends in `/api`",
      "one `sendByTemplate` call per channel",
      "unique across the whole Nudge account",
      "passes `recipientId` instead",
      "moves to v2",
      "`try`/`catch` on `NudgeError`",
      "`client.stats.details({ channel, notificationLogId })`",
      "`YYYY-MM-DDTHH:mm:ss`",
      "`transport: createFakeTransport({ templates })`",
    ]) {
      const at = list.indexOf(fragment, from);
      expect(at, fragment).toBeGreaterThanOrEqual(from);
      from = at + 1;
    }
  });
});
