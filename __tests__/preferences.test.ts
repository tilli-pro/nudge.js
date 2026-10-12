import { describe, expect, it } from "vitest";
import {
  type PreferenceUpdate,
  preferenceLookupRequest,
  preferenceUpdateRequest,
  readPreferenceList,
  readUpdateAccepted,
} from "../src/preferences.js";

const EMAIL = "recipient-1@example.com";
const PHONE = "+15550100001";

const PREFERENCE = {
  preferenceType: "Fixture category",
  channel: "Email",
  isSubscribed: true,
  ipAddress: null,
  termsVersion: null,
  modifiedBy: null,
  lastModifiedOn: "2026-10-11T09:00:00",
  subscribeConfEmailSentTime: null,
  unsubscribeReason: null,
};

function updateBody(update: PreferenceUpdate): Record<string, unknown> {
  const { body } = preferenceUpdateRequest(update);
  if (typeof body !== "object" || body === null)
    throw new Error("the request has no body");
  return body as Record<string, unknown>;
}

describe("preferenceLookupRequest", () => {
  it("posts get and history with custom fields as a tag list", () => {
    const lookup = {
      recipientId: "fixture-recipient",
      customFields: { segment: "a", region: "b" },
    };
    const body = {
      recipientId: "fixture-recipient",
      customFields: [
        { tagName: "segment", tagValue: "a" },
        { tagName: "region", tagValue: "b" },
      ],
    };
    expect(preferenceLookupRequest("preferences.get", lookup)).toEqual({
      operation: "preferences.get",
      method: "POST",
      path: "v1/CustomerPreference/Get",
      body,
    });
    expect(preferenceLookupRequest("preferences.history", lookup)).toEqual({
      operation: "preferences.history",
      method: "POST",
      path: "v1/CustomerPreference/GetHistory",
      body,
    });
  });

  it("sends an empty tag list without custom fields", () => {
    const { body } = preferenceLookupRequest("preferences.get", {
      recipientId: "fixture-recipient",
    });
    expect(body).toEqual({
      recipientId: "fixture-recipient",
      customFields: [],
    });
    expect(Object.keys(body as object)).toEqual([
      "recipientId",
      "customFields",
    ]);
  });
});

describe("readPreferenceList", () => {
  it("maps a preference and lower-cases its channel", () => {
    const full = {
      ...PREFERENCE,
      modifiedBy: "api",
      termsVersion: "1.0",
      ipAddress: "192.0.2.10",
      unsubscribeReason: "fixture reason",
      subscribeConfEmailSentTime: "2026-10-11T09:05:00",
    };
    const result = readPreferenceList([full]);
    expect(result).toEqual([
      {
        preferenceType: "Fixture category",
        channel: "email",
        isSubscribed: true,
        lastModifiedOn: "2026-10-11T09:00:00",
        modifiedBy: "api",
        unsubscribeReason: "fixture reason",
        termsVersion: "1.0",
        ipAddress: "192.0.2.10",
        confirmationSentOn: "2026-10-11T09:05:00",
      },
    ]);
    expect(Object.keys(result?.[0] ?? {})).toEqual([
      ...[
        "preferenceType",
        "channel",
        "isSubscribed",
        "lastModifiedOn",
        "modifiedBy",
      ],
      ...[
        "unsubscribeReason",
        "termsVersion",
        "ipAddress",
        "confirmationSentOn",
      ],
    ]);
    expect(
      readPreferenceList([{ ...PREFERENCE, lastModifiedOn: null }])?.[0]
        ?.lastModifiedOn,
    ).toBeNull();
    expect(readPreferenceList([])).toEqual([]);
  });

  it("maps the five channels Nudge names", () => {
    const result = readPreferenceList(
      ["Email", "SMS", "WhatsApp", "Push", "IVR"].map((channel) => ({
        ...PREFERENCE,
        channel,
      })),
    );
    expect(result?.map((item) => item.channel)).toEqual([
      "email",
      "sms",
      "whatsapp",
      "push",
      "ivr",
    ]);
  });

  it("omits a preference on a channel the SDK does not model", () => {
    const result = readPreferenceList(
      ["Email", "WebForm", "Print", "Wallet", "Pigeon"].map((channel) => ({
        ...PREFERENCE,
        channel,
      })),
    );
    expect(result?.map((item) => item.channel)).toEqual(["email"]);
    const { channel: _channel, ...withoutChannel } = PREFERENCE;
    expect(readPreferenceList([withoutChannel, PREFERENCE])).toHaveLength(1);
  });

  it("refuses a body that is not a list of preferences", () => {
    const { isSubscribed: _isSubscribed, ...withoutSubscription } = PREFERENCE;
    const refused: unknown[] = [
      undefined,
      null,
      "x",
      {},
      { data: [PREFERENCE] },
      [null],
      ["x"],
    ];
    refused.push(
      [{ ...PREFERENCE, preferenceType: 1 }],
      [{ ...PREFERENCE, isSubscribed: "true" }],
    );
    refused.push([withoutSubscription], [PREFERENCE, null]);
    for (const body of refused)
      expect(readPreferenceList(body)).toBeUndefined();
  });
});

describe("preferenceUpdateRequest", () => {
  it("maps identifiers, changes and consent fields", () => {
    const spec = preferenceUpdateRequest({
      recipientId: "fixture-recipient",
      email: EMAIL,
      phone: PHONE,
      customFields: { segment: "a" },
      changes: [
        {
          preferenceType: "Fixture category",
          email: true,
          sms: false,
          unsubscribeReason: "fixture reason",
        },
        { preferenceType: "Other category", sms: true },
      ],
      consentDate: "2026-10-11T09:00:00Z",
      ipAddress: "192.0.2.10",
      termsVersion: "1.0",
    });
    expect(spec).toEqual({
      operation: "preferences.update",
      method: "POST",
      path: "v1/CustomerPreference/Update",
      body: {
        recipientId: "fixture-recipient",
        emailAddress: EMAIL,
        phoneNumber: PHONE,
        customFields: [{ tagName: "segment", tagValue: "a" }],
        preferences: [
          {
            preferenceType: "Fixture category",
            emailSubscribed: true,
            smsSubscribed: false,
            unsubscribeReason: "fixture reason",
          },
          { preferenceType: "Other category", smsSubscribed: true },
        ],
        consentDate: "2026-10-11T09:00:00Z",
        ipAddress: "192.0.2.10",
        termsVersion: "1.0",
      },
    });
    const body = spec.body as { preferences: object[] };
    expect(Object.keys(body)).toEqual([
      ...["recipientId", "emailAddress", "phoneNumber", "customFields"],
      ...["preferences", "consentDate", "ipAddress", "termsVersion"],
    ]);
    expect(Object.keys(body.preferences[0] ?? {})).toEqual([
      ...[
        "preferenceType",
        "emailSubscribed",
        "smsSubscribed",
        "unsubscribeReason",
      ],
    ]);
    expect(Object.keys(body.preferences[1] ?? {})).toEqual([
      "preferenceType",
      "smsSubscribed",
    ]);
  });

  it("always sends customFields and only the given optional keys", () => {
    const body = updateBody({
      phone: PHONE,
      changes: [{ preferenceType: "Fixture category", email: true }],
    });
    expect(Object.keys(body)).toEqual([
      "phoneNumber",
      "customFields",
      "preferences",
    ]);
    expect(body.customFields).toEqual([]);
    expect(body.preferences).toEqual([
      { preferenceType: "Fixture category", emailSubscribed: true },
    ]);
  });
});

describe("readUpdateAccepted", () => {
  it("is true only for data.success true", () => {
    expect(readUpdateAccepted({ data: { success: true } })).toBe(true);
    expect(readUpdateAccepted({ Data: { Success: true } })).toBe(true);
    const refused: unknown[] = [
      { data: { success: false } },
      { data: { success: "true" } },
      { data: {} },
      { data: null },
    ];
    refused.push({ success: true }, [], "x", null, undefined);
    for (const body of refused) expect(readUpdateAccepted(body)).toBe(false);
  });
});
