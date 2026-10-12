import { isRecord, type NudgeRequestSpec, readField } from "./classify.js";
import { readString, toWireTags } from "./wire.js";

export type NudgeLogChannel = "email" | "sms" | "whatsapp" | "push" | "ivr";

export interface PreferenceLookup {
  readonly recipientId: string;
  readonly customFields?: Readonly<Record<string, string>>;
}

export interface RecipientPreference {
  readonly preferenceType: string;
  readonly channel: NudgeLogChannel;
  readonly isSubscribed: boolean;
  readonly lastModifiedOn: string | null;
  readonly modifiedBy: string | null;
  readonly unsubscribeReason: string | null;
  readonly termsVersion: string | null;
  readonly ipAddress: string | null;
  readonly confirmationSentOn: string | null;
}

export interface PreferenceChange {
  /** A category's external preference ref, or its name. */
  readonly preferenceType: string;
  readonly email?: boolean;
  readonly sms?: boolean;
  /** At most 100 characters. */
  readonly unsubscribeReason?: string;
}

export interface PreferenceUpdate {
  /** At least one of recipientId, email and phone. */
  readonly recipientId?: string;
  readonly email?: string;
  readonly phone?: string;
  readonly customFields?: Readonly<Record<string, string>>;
  /** At least one. */
  readonly changes: readonly PreferenceChange[];
  readonly consentDate?: string;
  readonly ipAddress?: string;
  readonly termsVersion?: string;
}

export type PreferenceLookupOperation =
  | "preferences.get"
  | "preferences.history";

const LOOKUP_PATH: Readonly<Record<PreferenceLookupOperation, string>> = {
  "preferences.get": "v1/CustomerPreference/Get",
  "preferences.history": "v1/CustomerPreference/GetHistory",
};

const LOG_CHANNELS: readonly string[] = [
  "email",
  "sms",
  "whatsapp",
  "push",
  "ivr",
];

function isLogChannel(value: string): value is NudgeLogChannel {
  return LOG_CHANNELS.includes(value);
}

export function preferenceLookupRequest(
  operation: PreferenceLookupOperation,
  lookup: PreferenceLookup,
): NudgeRequestSpec {
  return {
    operation,
    method: "POST",
    path: LOOKUP_PATH[operation],
    body: {
      recipientId: lookup.recipientId,
      customFields: toWireTags(lookup.customFields ?? {}),
    },
  };
}

export function readPreferenceList(
  body: unknown,
): readonly RecipientPreference[] | undefined {
  if (!Array.isArray(body)) return;
  const result: RecipientPreference[] = [];
  for (const item of body as unknown[]) {
    if (!isRecord(item)) return;
    const preferenceType = readString(item, "preferenceType");
    const isSubscribed = readField(item, "isSubscribed");
    if (preferenceType === null || typeof isSubscribed !== "boolean") {
      return;
    }
    const channel = readString(item, "channel")?.toLowerCase();
    if (channel === undefined || !isLogChannel(channel)) continue;
    result.push({
      preferenceType,
      channel,
      isSubscribed,
      lastModifiedOn: readString(item, "lastModifiedOn"),
      modifiedBy: readString(item, "modifiedBy"),
      unsubscribeReason: readString(item, "unsubscribeReason"),
      termsVersion: readString(item, "termsVersion"),
      ipAddress: readString(item, "ipAddress"),
      confirmationSentOn: readString(item, "subscribeConfEmailSentTime"),
    });
  }
  return result;
}

function changeBody(change: PreferenceChange): Record<string, unknown> {
  const body: Record<string, unknown> = {
    preferenceType: change.preferenceType,
  };
  if (change.email !== undefined) body.emailSubscribed = change.email;
  if (change.sms !== undefined) body.smsSubscribed = change.sms;
  if (change.unsubscribeReason !== undefined) {
    body.unsubscribeReason = change.unsubscribeReason;
  }
  return body;
}

export function preferenceUpdateRequest(
  update: PreferenceUpdate,
): NudgeRequestSpec {
  const body: Record<string, unknown> = {};
  if (update.recipientId !== undefined) body.recipientId = update.recipientId;
  if (update.email !== undefined) body.emailAddress = update.email;
  if (update.phone !== undefined) body.phoneNumber = update.phone;
  body.customFields = toWireTags(update.customFields ?? {});
  body.preferences = update.changes.map(changeBody);
  if (update.consentDate !== undefined) body.consentDate = update.consentDate;
  if (update.ipAddress !== undefined) body.ipAddress = update.ipAddress;
  if (update.termsVersion !== undefined)
    body.termsVersion = update.termsVersion;
  return {
    operation: "preferences.update",
    method: "POST",
    path: "v1/CustomerPreference/Update",
    body,
  };
}

export function readUpdateAccepted(body: unknown): boolean {
  return readField(readField(body, "data"), "success") === true;
}
