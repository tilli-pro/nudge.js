import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createNudgeClient } from "../src/index.js";

const REQUIRED = [
  "NUDGE_API_KEY",
  "NUDGE_BASE_URL",
  "NUDGE_FIXTURE_EMAIL",
  "NUDGE_FIXTURE_REF",
] as const;

const enabled =
  process.env.NUDGE_LIVE === "1" &&
  REQUIRED.every((name) => (process.env[name] ?? "") !== "");

function need(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is not set`);
  }
  return value;
}

describe.skipIf(!enabled)("live Nudge", () => {
  it("sends once, replays the same key and reads the details", async () => {
    const client = createNudgeClient({
      apiKey: need("NUDGE_API_KEY"),
      baseUrl: need("NUDGE_BASE_URL"),
    });
    const input = {
      externalRef: need("NUDGE_FIXTURE_REF"),
      channel: "email",
      to: { email: need("NUDGE_FIXTURE_EMAIL") },
      mergeTags: { fixtureTag: "live test" },
      idempotencyKey: `nudge-js-live:${randomUUID()}`,
    } as const;

    const first = await client.sendByTemplate(input);
    const second = await client.sendByTemplate(input);

    const { notificationLogId } = first;
    expect(notificationLogId).not.toBeNull();
    if (notificationLogId === null) {
      throw new Error("the first send returned no log id");
    }
    expect(second.notificationLogId).toBe(notificationLogId);

    const details = await client.stats.details({
      channel: "email",
      notificationLogId,
    });
    expect(details.notificationLogId).toBe(notificationLogId);
  });
});
