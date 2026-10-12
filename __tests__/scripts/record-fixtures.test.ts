import { describe, expect, it } from "vitest";
import {
  assertScrubbed,
  placeholderId,
  scrubFixture,
} from "../../scripts/record-fixtures.js";
import {
  findHygieneViolations,
  placeholderId as helperPlaceholderId,
} from "../helpers/fixtures.js";
import type { ScrubContext } from "../../scripts/record-fixtures.js";

const context: ScrubContext = {
  apiKey: "scrub-test-key",
  ref: "staging-ref",
  preference: "Staging category",
  email: "someone@example.net",
  phone: "+15559876543",
};

const GUID_A = "0A1B2C3D-0000-4000-8000-00000000000A";
const GUID_B = "0A1B2C3D-0000-4000-8000-00000000000B";

const SAMPLE = {
  request: {
    body: {
      toEmailAddress: "someone@example.net",
      cc: "other@example.net",
      idempotencyKey: GUID_A,
    },
  },
  response: {
    status: 200,
    body: {
      NotificationLogId: GUID_B,
      Errors: { [GUID_A]: "Mailbox other@example.net" },
      phone: "+15559876543",
      also: "15559876544",
    },
  },
};

describe("scrubFixture", () => {
  it("replaces the key, the ref and the preference", () => {
    const input = {
      request: {
        body: {
          nudgeExternalRef: "staging-ref",
          preference: "Staging category",
        },
      },
      note: "sent with scrub-test-key",
      unknown: "staging-ref-unknown",
    };
    expect(scrubFixture(input, context)).toEqual({
      request: {
        body: {
          nudgeExternalRef: "fixture-ref",
          preference: "Fixture category",
        },
      },
      note: "sent with <api-key>",
      unknown: "fixture-ref-unknown",
    });
  });

  it("renames every other category", () => {
    const input = {
      items: [
        { preferenceType: "Staging category" },
        { preferenceType: "Second one" },
        { preferenceType: "Second one" },
        { preferenceType: "Third one" },
        { preferenceType: "fixture-unknown-category" },
      ],
    };
    expect(scrubFixture(input, context)).toEqual({
      items: [
        { preferenceType: "Fixture category" },
        { preferenceType: "Other category 1" },
        { preferenceType: "Other category 1" },
        { preferenceType: "Other category 2" },
        { preferenceType: "fixture-unknown-category" },
      ],
    });
  });

  it("numbers GUIDs by first appearance, keys included", () => {
    const input = {
      Errors: { [GUID_A]: "Mailbox unavailable" },
      later: { id: GUID_B, again: GUID_A.toLowerCase() },
    };
    expect(scrubFixture(input, context)).toEqual({
      Errors: { [placeholderId(1)]: "Mailbox unavailable" },
      later: { id: placeholderId(2), again: placeholderId(1) },
    });
  });

  it("numbers addresses and phone numbers per fixture", () => {
    const input = {
      to: "someone@example.net",
      cc: "other@example.net",
      text: "Email: SOMEONE@example.net is not whitelisted",
      phone: "+15559876543",
      second: "+15559876545",
    };
    expect(scrubFixture(input, context)).toEqual({
      to: "recipient-1@example.com",
      cc: "recipient-2@example.com",
      text: "Email: recipient-1@example.com is not whitelisted",
      phone: "+15550100001",
      second: "+15550100002",
    });
    expect(
      scrubFixture({ to: "other@example.net", phone: "+15559876545" }, context),
    ).toEqual({ to: "recipient-1@example.com", phone: "+15550100001" });
  });

  it("keeps a bare number bare", () => {
    expect(scrubFixture({ digits: "15559876544" }, context)).toEqual({
      digits: "15550100001",
    });
    expect(
      scrubFixture({ plus: "+15559876544", bare: "15559876544" }, context),
    ).toEqual({ plus: "+15550100001", bare: "15550100001" });
  });

  it("zeroes account ids", () => {
    const input = { AccountId: 42, nested: [{ accountId: "42" }], other: 7 };
    expect(scrubFixture(input, context)).toEqual({
      AccountId: 0,
      nested: [{ accountId: 0 }],
      other: 7,
    });
  });

  it("leaves numbers, booleans and timestamps alone", () => {
    const input = {
      sentOn: "2026-10-11T09:30:02",
      Code: 400,
      HasErrors: true,
      Errors: null,
      list: [1, 2.5, false],
    };
    expect(scrubFixture(input, context)).toEqual(input);
  });

  it("returns a copy and leaves its input untouched", () => {
    const input = { request: { to: "someone@example.net", ids: [GUID_A] } };
    const before = structuredClone(input);
    const output = scrubFixture(input, context);
    expect(input).toEqual(before);
    expect(output).not.toBe(input);
  });

  it("produces output the hygiene rules accept", () => {
    const before = findHygieneViolations(JSON.stringify(SAMPLE));
    expect(before.guids).toEqual([GUID_A, GUID_B, GUID_A]);
    expect(before.emails).toEqual([
      "someone@example.net",
      "other@example.net",
      "other@example.net",
    ]);
    const after = findHygieneViolations(
      JSON.stringify(scrubFixture(SAMPLE, context)),
    );
    expect(after).toEqual({
      guids: [],
      emails: [],
      phones: [],
      authorization: false,
    });
  });
});

describe("placeholderId", () => {
  it("matches the fixture helper's", () => {
    for (const n of [1, 2, 12, 999999999999]) {
      expect(placeholderId(n)).toBe(helperPlaceholderId(n));
    }
  });
});

describe("assertScrubbed", () => {
  it("accepts scrubbed text", () => {
    const text = JSON.stringify(scrubFixture(SAMPLE, context));
    expect(() => assertScrubbed(text, context)).not.toThrow();
  });

  it.each([
    ["the api key", "sent with scrub-test-key"],
    ["the fixture address", "to SOMEONE@example.net"],
    ["the fixture number", "to 15559876543"],
    ["a GUID", GUID_A],
    ["an address", "to x@example.org"],
    ["a number", "to +12025550123"],
  ])("refuses text that still holds %s", (what, text) => {
    expect(() => assertScrubbed(text, context)).toThrow(
      `record-fixtures: ${what} survived scrubbing`,
    );
  });
});
