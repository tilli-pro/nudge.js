import { isRecord, type NudgeRequestSpec, readField } from "./classify.js";
import {
  CHANNEL_CODE,
  CHANNEL_QUERY_NAME,
  digitsOnly,
  type NudgeChannel,
  readString,
} from "./wire.js";

export interface StatsQuery {
  readonly channel: NudgeChannel;
  /** IANA id: Nudge reads from/to and writes the times in it. */
  readonly timeZone: string;
  readonly notificationLogId?: string;
  readonly recipientId?: string;
  readonly email?: string;
  readonly phone?: string;
  /** Nudge's NotificationLogStatus value. */
  readonly status?: number;
  /**
   * "YYYY-MM-DDTHH:mm:ss" wall time in timeZone. Nudge returns logs scheduled
   * in [from, to + 24 h); without from it starts at now - 7 days, without to it
   * ends at now + 24 h.
   */
  readonly from?: string;
  readonly to?: string;
  readonly skip?: number;
  /** 1..100; Nudge's default is 10. */
  readonly top?: number;
}

export interface NotificationLogEntry {
  readonly notificationLogId: string;
  readonly recipientId: string | null;
  readonly email: string | null;
  readonly phone: string | null;
  /** Wall time in the query's timeZone. */
  readonly scheduledOn: string;
  /** Wall time in the query's timeZone. */
  readonly sentOn: string | null;
  readonly status: number;
  readonly statusText: string;
  readonly failureDescription: string | null;
  readonly nudgeName: string | null;
  readonly clicksCount: number;
}

export interface NotificationLogPage {
  readonly entries: readonly NotificationLogEntry[];
}

export interface NotificationDetails {
  readonly notificationLogId: string;
  readonly recipientId: string | null;
  readonly email: string | null;
  readonly phone: string | null;
  readonly status: string;
  readonly customFields: Readonly<Record<string, unknown>>;
  readonly paymentUrl: string | null;
  /** Nudge sends null for archived logs; the SDK maps it to []. */
  readonly mergeTags: readonly {
    readonly name: string;
    readonly value: string;
    readonly isServiceTag: boolean;
  }[];
}

export interface StatsDetailsInput {
  readonly channel: NudgeChannel;
  readonly notificationLogId: string;
}

function readNumber(body: unknown, name: string): number | null {
  const value = readField(body, name);
  return typeof value === "number" ? value : null;
}

export function statsListRequest(query: StatsQuery): NudgeRequestSpec {
  const body: Record<string, unknown> = {
    channel: CHANNEL_CODE[query.channel],
    ianaTimeZoneId: query.timeZone,
  };
  if (query.notificationLogId !== undefined) {
    body.notificationLogId = query.notificationLogId;
  }
  if (query.recipientId !== undefined) body.recipientId = query.recipientId;
  if (query.email !== undefined) body.email = query.email;
  if (query.phone !== undefined) body.mobileNumber = digitsOnly(query.phone);
  if (query.status !== undefined) body.status = query.status;
  if (query.from !== undefined) body.fromTime = query.from;
  if (query.to !== undefined) body.toTime = query.to;
  if (query.skip !== undefined) body.skip = query.skip;
  if (query.top !== undefined) body.top = query.top;
  return {
    operation: "stats.list",
    method: "POST",
    path: "v1/NotificationStats",
    body,
  };
}

function readEntry(item: unknown): NotificationLogEntry | undefined {
  if (!isRecord(item)) return;
  const guid = readString(item, "guid");
  const scheduledOn = readString(item, "scheduledOn");
  const statusText = readString(item, "statusText");
  const status = readNumber(item, "status");
  const clicksCount = readNumber(item, "clicksCount");
  if (
    guid === null ||
    scheduledOn === null ||
    statusText === null ||
    status === null ||
    clicksCount === null
  ) {
    return;
  }
  return {
    notificationLogId: guid,
    recipientId: readString(item, "recipientId"),
    email: readString(item, "toEmail"),
    phone: readString(item, "mobileNumber"),
    scheduledOn,
    sentOn: readString(item, "sentOn"),
    status,
    statusText,
    failureDescription: readString(item, "failureDescription"),
    nudgeName: readString(item, "nudgeName"),
    clicksCount,
  };
}

export function readLogPage(body: unknown): NotificationLogPage | undefined {
  const data = readField(body, "data");
  if (!isRecord(data)) return;
  const pageData = readField(data, "pageData");
  if (!Array.isArray(pageData)) return;
  const entries: NotificationLogEntry[] = [];
  for (const item of pageData as unknown[]) {
    const entry = readEntry(item);
    if (entry === undefined) return;
    entries.push(entry);
  }
  return { entries };
}

export function statsDetailsRequest(
  input: StatsDetailsInput,
): NudgeRequestSpec {
  return {
    operation: "stats.details",
    method: "GET",
    path: "v1/NotificationStats/GetNotificationDetails",
    query: {
      channel: CHANNEL_QUERY_NAME[input.channel],
      notificationLogId: input.notificationLogId,
    },
  };
}

function readMergeTags(
  value: unknown,
): NotificationDetails["mergeTags"] | undefined {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) return;
  const tags: { name: string; value: string; isServiceTag: boolean }[] = [];
  for (const item of value as unknown[]) {
    const name = readString(item, "name");
    if (name === null) return;
    tags.push({
      name,
      value: readString(item, "value") ?? "",
      isServiceTag: readField(item, "isServiceTag") === true,
    });
  }
  return tags;
}

export function readDetails(body: unknown): NotificationDetails | undefined {
  const data = readField(body, "data");
  if (!isRecord(data)) return;
  const id = readString(data, "id");
  const status = readString(data, "status");
  if (id === null || status === null) return;
  const mergeTags = readMergeTags(readField(data, "mergeTags"));
  if (mergeTags === undefined) return;
  const customFields = readField(data, "customFields");
  return {
    notificationLogId: id,
    recipientId: readString(data, "recipientId"),
    email: readString(data, "email"),
    phone: readString(data, "phoneNumber"),
    status,
    customFields: isRecord(customFields) ? customFields : {},
    paymentUrl: readString(data, "paymentUrl"),
    mergeTags,
  };
}
