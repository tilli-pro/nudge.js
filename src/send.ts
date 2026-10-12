import {
  CHANNEL_CODE,
  type NudgeChannel,
  readString,
  toWireTags,
} from "./wire.js";
import type { NudgeRequestSpec } from "./classify.js";

export type NudgeRecipient =
  | { readonly email: string }
  | { readonly phone: string };

export interface SendByTemplateInput {
  /** Nudge's NudgeExternalRef, resolved per channel. */
  readonly externalRef: string;
  readonly channel: NudgeChannel;
  /** The email for "email", the phone for "sms". */
  readonly to: NudgeRecipient;
  /** Tag names without %. */
  readonly mergeTags: Readonly<Record<string, string>>;
  /** 1 to 200 characters; maps to IdempotencyKey. */
  readonly idempotencyKey?: string;
  /**
   * Maps to RecipientId; Nudge stores it on the log and keys its per-recipient
   * rate limit by it (else the address).
   */
  readonly recipientId?: string;
}

export interface SendResult {
  readonly accepted: true;
  readonly notificationLogId: string | null;
}

function addressOf(input: SendByTemplateInput): Record<string, unknown> {
  const to = input.to as { readonly email?: string; readonly phone?: string };
  return input.channel === "email"
    ? { toEmailAddress: to.email }
    : { toPhoneNumber: to.phone };
}

export function sendRequest(input: SendByTemplateInput): NudgeRequestSpec {
  const body: Record<string, unknown> = {
    nudgeExternalRef: input.externalRef,
    channel: CHANNEL_CODE[input.channel],
    ...addressOf(input),
    mergeTags: toWireTags(input.mergeTags),
  };
  if (input.idempotencyKey !== undefined) {
    body.idempotencyKey = input.idempotencyKey;
  }
  if (input.recipientId !== undefined) body.recipientId = input.recipientId;
  return { operation: "send", method: "POST", path: "v2/Nudge/Send", body };
}

export function readSendResult(body: unknown): SendResult {
  const id = readString(body, "notificationLogId");
  return {
    accepted: true,
    notificationLogId: id !== null && id.length > 0 ? id : null,
  };
}
