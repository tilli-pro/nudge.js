import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  FIXTURES_DIR,
  type Fixture,
  findHygieneViolations,
  loadFixture,
  loadFixtures,
  PERMANENTLY_DERIVED,
  placeholderId,
} from "./helpers/fixtures.js";

const ROOT = resolve(import.meta.dirname, "..");
const EMAIL = "recipient-1@example.com";
const PHONE = "+15550100001";
const FIXTURE_NAME = /^[a-z]+(\.[a-z]+)?\.[a-z0-9-]+$/;
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];

const FILES = [
  ...readdirSync(FIXTURES_DIR)
    .filter((file) => file.endsWith(".json"))
    .sort()
    .map((file) => `fixtures/${file}`),
  "README.md",
];

function read(file: string): string {
  return readFileSync(resolve(ROOT, file), "utf8");
}

describe("public content", () => {
  it.each(FILES)("%s uses only placeholder GUIDs", (file) => {
    expect(findHygieneViolations(read(file)).guids).toEqual([]);
  });

  it.each(FILES)("%s uses only example.com addresses", (file) => {
    expect(findHygieneViolations(read(file)).emails).toEqual([]);
  });

  it.each(FILES)("%s uses only +1555 phone numbers", (file) => {
    expect(findHygieneViolations(read(file)).phones).toEqual([]);
  });

  it.each(FILES)("%s carries no Authorization value", (file) => {
    expect(findHygieneViolations(read(file)).authorization).toBe(false);
  });
});

describe("findHygieneViolations", () => {
  it("flags a non-placeholder GUID, an address outside example.com, a non-555 number and an Authorization value", () => {
    const text =
      '{"id":"0A1B2C3D-0000-4000-8000-000000000001","to":"someone@example.org","phone":"+12025550123","Authorization":"x"}';
    expect(findHygieneViolations(text)).toEqual({
      guids: ["0A1B2C3D-0000-4000-8000-000000000001"],
      emails: ["someone@example.org"],
      phones: ["+12025550123"],
      authorization: true,
    });
  });

  it("accepts the placeholders", () => {
    const text = JSON.stringify({
      id: placeholderId(7),
      to: EMAIL,
      phone: PHONE,
      bare: "15550100002",
    });
    expect(findHygieneViolations(text)).toEqual({
      guids: [],
      emails: [],
      phones: [],
      authorization: false,
    });
  });

  it("never reads a placeholder GUID's last group as a phone number", () => {
    expect(findHygieneViolations(placeholderId(7)).phones).toEqual([]);
    expect(findHygieneViolations(placeholderId(999999999999)).phones).toEqual(
      [],
    );
  });
});

describe("fixtures", () => {
  it.each(loadFixtures().map((f): [string, Fixture] => [f.name, f]))(
    "%s has the fixture shape",
    (name, fixture) => {
      const raw = JSON.parse(
        readFileSync(resolve(FIXTURES_DIR, `${name}.json`), "utf8"),
      ) as Record<string, unknown>;
      expect(Object.keys(raw)).toEqual([
        "origin",
        "source",
        "request",
        "response",
      ]);
      expect(["derived", "recorded"]).toContain(fixture.origin);
      expect(typeof fixture.source).toBe("string");
      expect(fixture.source.length).toBeGreaterThan(0);
      expect(METHODS).toContain(fixture.request.method);
      expect(fixture.request.path.length).toBeGreaterThan(0);
      expect(fixture.request.path.startsWith("/")).toBe(false);
      for (const value of Object.values(fixture.request.query ?? {})) {
        expect(typeof value).toBe("string");
      }
      expect(Number.isInteger(fixture.response.status)).toBe(true);
      expect(typeof fixture.response.headers).toBe("object");
      expect(fixture.response.headers).not.toBeNull();
      for (const value of Object.values(fixture.response.headers)) {
        expect(typeof value).toBe("string");
      }
    },
  );

  it("keeps the ten permanently derived fixtures derived", () => {
    expect(PERMANENTLY_DERIVED).toHaveLength(10);
    for (const name of PERMANENTLY_DERIVED) {
      expect(loadFixture(name).origin).toBe("derived");
    }
  });

  it("names every fixture <operation>.<case>.json", () => {
    const fixtures = loadFixtures();
    expect(fixtures).toHaveLength(27);
    for (const fixture of fixtures) {
      expect(fixture.name).toMatch(FIXTURE_NAME);
      expect(fixture.operation).toBe(
        fixture.name.slice(0, fixture.name.lastIndexOf(".")),
      );
    }
  });
});
