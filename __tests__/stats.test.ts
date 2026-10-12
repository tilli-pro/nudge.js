import { describe, expect, it } from "vitest";
import {
  readDetails,
  readLogPage,
  type StatsQuery,
  statsDetailsRequest,
  statsListRequest,
} from "../src/stats.js";
import { placeholderId } from "./helpers/fixtures.js";

const EMAIL = "recipient-1@example.com";
const PHONE = "+15550100001";

const FULL_QUERY: StatsQuery = {
  channel: "sms",
  timeZone: "Europe/Berlin",
  notificationLogId: placeholderId(1),
  recipientId: "fixture-recipient",
  email: EMAIL,
  phone: PHONE,
  status: 3,
  from: "2026-10-11T00:00:00",
  to: "2026-10-12T00:00:00",
  skip: 20,
  top: 10,
};

function bodyOf(query: StatsQuery): Record<string, unknown> {
  const { body } = statsListRequest(query);
  if (typeof body !== "object" || body === null)
    throw new Error("the request has no body");
  return body as Record<string, unknown>;
}

const envelope = (data: unknown) => ({
  data,
  code: 200,
  errCode: 0,
  errors: [],
  hasErrors: false,
  errorGuid: null,
});

describe("statsListRequest", () => {
  it("posts the channel as a number with the time zone", () => {
    const spec = statsListRequest({ channel: "email", timeZone: "UTC" });
    expect(spec).toEqual({
      operation: "stats.list",
      method: "POST",
      path: "v1/NotificationStats",
      body: { channel: 0, ianaTimeZoneId: "UTC" },
    });
    expect(Object.keys(spec).sort()).toEqual([
      "body",
      "method",
      "operation",
      "path",
    ]);
    expect(Object.keys(bodyOf({ channel: "email", timeZone: "UTC" }))).toEqual([
      "channel",
      "ianaTimeZoneId",
    ]);
    expect(bodyOf({ channel: "sms", timeZone: "UTC" })).toEqual({
      channel: 1,
      ianaTimeZoneId: "UTC",
    });
  });

  it("adds optional filters only when given", () => {
    expect(bodyOf(FULL_QUERY)).toEqual({
      channel: 1,
      ianaTimeZoneId: "Europe/Berlin",
      notificationLogId: placeholderId(1),
      recipientId: "fixture-recipient",
      email: EMAIL,
      mobileNumber: "15550100001",
      status: 3,
      fromTime: "2026-10-11T00:00:00",
      toTime: "2026-10-12T00:00:00",
      skip: 20,
      top: 10,
    });
    expect(Object.keys(bodyOf(FULL_QUERY))).toEqual([
      ...[
        "channel",
        "ianaTimeZoneId",
        "notificationLogId",
        "recipientId",
        "email",
        "mobileNumber",
      ],
      ...["status", "fromTime", "toTime", "skip", "top"],
    ]);
    const zeros = bodyOf({
      channel: "email",
      timeZone: "UTC",
      skip: 0,
      status: 0,
    });
    expect(Object.keys(zeros)).toEqual([
      "channel",
      "ianaTimeZoneId",
      "status",
      "skip",
    ]);
  });

  it("sends the phone as digits only", () => {
    const body = bodyOf({
      channel: "sms",
      timeZone: "UTC",
      phone: "+1 (555) 010-0001",
    });
    expect(body.mobileNumber).toBe("15550100001");
    expect(body).not.toHaveProperty("phone");
  });

  it("sends from and to unchanged as fromTime and toTime", () => {
    const body = bodyOf({
      channel: "email",
      timeZone: "UTC",
      from: "2026-10-11T08:15:30",
      to: "2026-10-11T00:00:00",
    });
    expect(body.fromTime).toBe("2026-10-11T08:15:30");
    expect(body.toTime).toBe("2026-10-11T00:00:00");
  });

  it("never asks for clicks", () => {
    expect(bodyOf(FULL_QUERY)).not.toHaveProperty("returnClicks");
  });
});

describe("readLogPage", () => {
  const ENTRY = {
    guid: placeholderId(1),
    recipientId: "fixture-recipient",
    toEmail: EMAIL,
    mobileNumber: null,
    scheduledOn: "2026-10-11T09:30:00",
    status: 4,
    statusText: "Delivered",
    failureDescription: null,
    nudgeName: "Fixture nudge",
    nudgeRunId: null,
    clicksCount: 0,
    sentOn: "2026-10-11T09:30:02",
  };
  const page = (entries: unknown[]) =>
    envelope({ pageData: entries, totalCount: entries.length, errors: 0 });

  it("maps every field of an entry", () => {
    const failed = {
      ...ENTRY,
      guid: placeholderId(2),
      recipientId: null,
      toEmail: null,
      mobileNumber: "15550100001",
      status: 3,
      statusText: "Failed",
      failureDescription: "Mailbox unavailable",
      clicksCount: 2,
    };
    const result = readLogPage(page([ENTRY, failed]));
    expect(result).toEqual({
      entries: [
        {
          notificationLogId: placeholderId(1),
          recipientId: "fixture-recipient",
          email: EMAIL,
          phone: null,
          scheduledOn: "2026-10-11T09:30:00",
          sentOn: "2026-10-11T09:30:02",
          status: 4,
          statusText: "Delivered",
          failureDescription: null,
          nudgeName: "Fixture nudge",
          clicksCount: 0,
        },
        {
          notificationLogId: placeholderId(2),
          recipientId: null,
          email: null,
          phone: "15550100001",
          scheduledOn: "2026-10-11T09:30:00",
          sentOn: "2026-10-11T09:30:02",
          status: 3,
          statusText: "Failed",
          failureDescription: "Mailbox unavailable",
          nudgeName: "Fixture nudge",
          clicksCount: 2,
        },
      ],
    });
    expect(Object.keys(result?.entries[0] ?? {})).toEqual([
      ...[
        "notificationLogId",
        "recipientId",
        "email",
        "phone",
        "scheduledOn",
        "sentOn",
      ],
      ...[
        "status",
        "statusText",
        "failureDescription",
        "nudgeName",
        "clicksCount",
      ],
    ]);
    expect(readLogPage(page([]))).toEqual({ entries: [] });
  });

  it("reads an absent sentOn and absent strings as null", () => {
    const minimal = {
      guid: placeholderId(1),
      scheduledOn: "2026-10-11T09:31:00",
      status: 0,
      statusText: "Created",
      clicksCount: 0,
    };
    expect(readLogPage(page([minimal]))?.entries).toEqual([
      {
        notificationLogId: placeholderId(1),
        recipientId: null,
        email: null,
        phone: null,
        scheduledOn: "2026-10-11T09:31:00",
        sentOn: null,
        status: 0,
        statusText: "Created",
        failureDescription: null,
        nudgeName: null,
        clicksCount: 0,
      },
    ]);
  });

  it("refuses a body without data.pageData", () => {
    const refused: unknown[] = [
      undefined,
      null,
      "x",
      [],
      {},
      { data: null },
      { data: {} },
    ];
    refused.push({ data: { pageData: {} } }, page([null]));
    for (const body of refused) expect(readLogPage(body)).toBeUndefined();
  });

  it("refuses an entry without its guid", () => {
    for (const key of [
      "guid",
      "scheduledOn",
      "statusText",
      "status",
      "clicksCount",
    ]) {
      const without = Object.fromEntries(
        Object.entries(ENTRY).filter(([name]) => name !== key),
      );
      expect(readLogPage(page([ENTRY, without]))).toBeUndefined();
    }
    expect(readLogPage(page([{ ...ENTRY, status: "4" }]))).toBeUndefined();
    expect(readLogPage(page([{ ...ENTRY, clicksCount: "0" }]))).toBeUndefined();
  });
});

describe("statsDetailsRequest", () => {
  it("gets the details with the channel's name and the id in the query", () => {
    const spec = statsDetailsRequest({
      channel: "email",
      notificationLogId: placeholderId(1),
    });
    expect(spec).toEqual({
      operation: "stats.details",
      method: "GET",
      path: "v1/NotificationStats/GetNotificationDetails",
      query: { channel: "Email", notificationLogId: placeholderId(1) },
    });
    expect(spec).not.toHaveProperty("body");
    const sms = statsDetailsRequest({
      channel: "sms",
      notificationLogId: placeholderId(2),
    });
    expect(sms.query).toEqual({
      channel: "SMS",
      notificationLogId: placeholderId(2),
    });
  });
});

describe("readDetails", () => {
  const DETAILS = {
    id: placeholderId(1),
    recipientId: "fixture-recipient",
    email: EMAIL,
    phoneNumber: null,
    status: "Delivered",
    paymentUrl: null,
    customFields: {},
    mergeTags: [
      { name: "fixtureTag", value: "fixture value", isServiceTag: false },
      { name: "Unsubscribe", value: null, isServiceTag: true },
    ],
  };

  it("maps the details", () => {
    const result = readDetails(envelope(DETAILS));
    expect(result).toEqual({
      notificationLogId: placeholderId(1),
      recipientId: "fixture-recipient",
      email: EMAIL,
      phone: null,
      status: "Delivered",
      customFields: {},
      paymentUrl: null,
      mergeTags: [
        { name: "fixtureTag", value: "fixture value", isServiceTag: false },
        { name: "Unsubscribe", value: "", isServiceTag: true },
      ],
    });
    expect(Object.keys(result ?? {})).toEqual([
      ...["notificationLogId", "recipientId", "email", "phone"],
      ...["status", "customFields", "paymentUrl", "mergeTags"],
    ]);
    const sms = readDetails(
      envelope({
        ...DETAILS,
        email: null,
        phoneNumber: "15550100001",
        paymentUrl: "https://example.com/pay",
      }),
    );
    expect(sms).toMatchObject({
      email: null,
      phone: "15550100001",
      paymentUrl: "https://example.com/pay",
    });
  });

  it("reads null merge tags as an empty list", () => {
    expect(
      readDetails(envelope({ ...DETAILS, mergeTags: null }))?.mergeTags,
    ).toEqual([]);
    const { mergeTags: _omitted, ...absent } = DETAILS;
    expect(readDetails(envelope(absent))?.mergeTags).toEqual([]);
  });

  it("reads null custom fields as an empty record", () => {
    expect(
      readDetails(envelope({ ...DETAILS, customFields: null }))?.customFields,
    ).toEqual({});
    expect(
      readDetails(envelope({ ...DETAILS, customFields: { account: 7 } }))
        ?.customFields,
    ).toEqual({ account: 7 });
  });

  it("refuses details without an id", () => {
    const { id: _id, ...withoutId } = DETAILS;
    const { status: _status, ...withoutStatus } = DETAILS;
    const refused: unknown[] = [
      undefined,
      null,
      "x",
      [],
      {},
      { data: null },
      envelope(withoutId),
      envelope(withoutStatus),
    ];
    refused.push(
      envelope({ ...DETAILS, id: 5 }),
      envelope({ ...DETAILS, status: 4 }),
      envelope({ ...DETAILS, mergeTags: "x" }),
    );
    refused.push(
      envelope({
        ...DETAILS,
        mergeTags: [{ value: "v", isServiceTag: false }],
      }),
    );
    for (const body of refused) expect(readDetails(body)).toBeUndefined();
  });
});
