import { readField } from "./classify.js";

export type NudgeChannel = "email" | "sms";

export interface WireMergeTag {
  readonly tagName: string;
  readonly tagValue: string;
}

export const CHANNEL_CODE: Readonly<Record<NudgeChannel, 0 | 1>> = {
  email: 0,
  sms: 1,
};

export const CHANNEL_QUERY_NAME: Readonly<Record<NudgeChannel, string>> = {
  email: "Email",
  sms: "SMS",
};

const NON_DIGITS = /[^0-9]/g;

export function channelFromCode(code: unknown): NudgeChannel | undefined {
  if (code === 0) return "email";
  if (code === 1) return "sms";
  return;
}

export function toWireTags(
  tags: Readonly<Record<string, string>>,
): WireMergeTag[] {
  return Object.entries(tags).map(([tagName, tagValue]) => ({
    tagName,
    tagValue,
  }));
}

export function fromWireTags(
  value: unknown,
): Record<string, string> | undefined {
  if (!Array.isArray(value)) return;
  const pairs: [string, string][] = [];
  for (const item of value as unknown[]) {
    const name = readField(item, "tagName");
    const tagValue = readField(item, "tagValue");
    if (typeof name !== "string" || typeof tagValue !== "string") {
      return;
    }
    pairs.push([name, tagValue]);
  }
  return Object.fromEntries(pairs);
}

export function readString(body: unknown, name: string): string | null {
  const value = readField(body, name);
  return typeof value === "string" ? value : null;
}

export function digitsOnly(value: string): string {
  return value.replace(NON_DIGITS, "");
}
