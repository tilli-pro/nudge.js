import { describe, expect, it } from "vitest";
import {
  CHANNEL_CODE,
  CHANNEL_QUERY_NAME,
  channelFromCode,
  digitsOnly,
  fromWireTags,
  readString,
  toWireTags,
} from "../src/wire.js";

describe("toWireTags", () => {
  it("keeps the record's key order", () => {
    expect(toWireTags({ zeta: "1", alpha: "2", mid: "" })).toEqual([
      { tagName: "zeta", tagValue: "1" },
      { tagName: "alpha", tagValue: "2" },
      { tagName: "mid", tagValue: "" },
    ]);
    expect(toWireTags({})).toEqual([]);
  });
});

describe("fromWireTags", () => {
  it("turns a tag list back into a record", () => {
    const record = fromWireTags([
      { tagName: "zeta", tagValue: "1" },
      { TagName: "alpha", TagValue: "2" },
      { tagName: "zeta", tagValue: "3" },
    ]);
    expect(record).toEqual({ zeta: "3", alpha: "2" });
    expect(Object.keys(record ?? {})).toEqual(["zeta", "alpha"]);
    expect(fromWireTags([])).toEqual({});
    expect(
      Object.keys(
        fromWireTags([{ tagName: "__proto__", tagValue: "x" }]) ?? {},
      ),
    ).toEqual(["__proto__"]);
  });

  it("refuses anything but a list of name and value pairs", () => {
    const refused: unknown[] = [undefined, null, "x", {}, [null], [["a", "b"]]];
    refused.push(
      [{ tagName: "a" }],
      [{ tagValue: "a" }],
      [{ tagName: "a", tagValue: 1 }],
      [{ tagName: 1, tagValue: "a" }],
    );
    for (const value of refused) expect(fromWireTags(value)).toBeUndefined();
  });
});

describe("channels", () => {
  it("maps email to 0 and sms to 1, and back", () => {
    expect(CHANNEL_CODE).toEqual({ email: 0, sms: 1 });
    expect(channelFromCode(0)).toBe("email");
    expect(channelFromCode(1)).toBe("sms");
  });

  it("names channels for the details query", () => {
    expect(CHANNEL_QUERY_NAME).toEqual({ email: "Email", sms: "SMS" });
  });

  it("reads no channel from other codes", () => {
    for (const code of [
      2,
      -1,
      0.5,
      "0",
      "email",
      null,
      undefined,
      true,
      Number.NaN,
    ]) {
      expect(channelFromCode(code)).toBeUndefined();
    }
  });
});

describe("readString", () => {
  it("reads a string ignoring key case and nothing else", () => {
    expect(readString({ NotificationLogId: "a" }, "notificationLogId")).toBe(
      "a",
    );
    expect(readString({ id: "" }, "id")).toBe("");
    for (const body of [{ id: 1 }, { id: null }, {}, ["id"], null, "id"])
      expect(readString(body, "id")).toBeNull();
  });
});

describe("digitsOnly", () => {
  it("keeps only digits", () => {
    expect(digitsOnly("+1 (555) 010-0001")).toBe("15550100001");
    expect(digitsOnly("abc")).toBe("");
    expect(digitsOnly("")).toBe("");
  });
});
