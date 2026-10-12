import { describe, expect, it } from "vitest";
import {
  readSendResult,
  type SendByTemplateInput,
  sendRequest,
} from "../src/send.js";
import { placeholderId } from "./helpers/fixtures.js";

const EMAIL = "recipient-1@example.com";
const PHONE = "+15550100001";
const REF = "fixture-ref";
const TAG_LIST = [{ tagName: "fixtureTag", tagValue: "fixture value" }];

const email: SendByTemplateInput = {
  externalRef: REF,
  channel: "email",
  to: { email: EMAIL },
  mergeTags: { fixtureTag: "fixture value" },
};
const sms: SendByTemplateInput = {
  ...email,
  channel: "sms",
  to: { phone: PHONE },
};

function bodyOf(input: SendByTemplateInput): Record<string, unknown> {
  const { body } = sendRequest(input);
  if (typeof body !== "object" || body === null)
    throw new Error("the request has no body");
  return body as Record<string, unknown>;
}

describe("sendRequest", () => {
  it("posts an e-mail send to v2/Nudge/Send", () => {
    const spec = sendRequest(email);
    expect(spec).toEqual({
      operation: "send",
      method: "POST",
      path: "v2/Nudge/Send",
      body: {
        nudgeExternalRef: REF,
        channel: 0,
        toEmailAddress: EMAIL,
        mergeTags: TAG_LIST,
      },
    });
    expect(Object.keys(spec).sort()).toEqual([
      "body",
      "method",
      "operation",
      "path",
    ]);
    expect(Object.keys(bodyOf(email))).toEqual([
      "nudgeExternalRef",
      "channel",
      "toEmailAddress",
      "mergeTags",
    ]);
  });

  it("posts an SMS send with toPhoneNumber", () => {
    expect(bodyOf(sms)).toEqual({
      nudgeExternalRef: REF,
      channel: 1,
      toPhoneNumber: PHONE,
      mergeTags: TAG_LIST,
    });
    expect(Object.keys(bodyOf(sms))).toEqual([
      "nudgeExternalRef",
      "channel",
      "toPhoneNumber",
      "mergeTags",
    ]);
  });

  it("adds idempotencyKey and recipientId only when given", () => {
    const base = ["nudgeExternalRef", "channel", "toEmailAddress", "mergeTags"];
    const key = placeholderId(1);
    expect(Object.keys(bodyOf({ ...email, idempotencyKey: key }))).toEqual([
      ...base,
      "idempotencyKey",
    ]);
    expect(
      Object.keys(bodyOf({ ...email, recipientId: "fixture-recipient" })),
    ).toEqual([...base, "recipientId"]);
    const both = bodyOf({
      ...email,
      recipientId: "fixture-recipient",
      idempotencyKey: key,
    });
    expect(Object.keys(both)).toEqual([
      ...base,
      "idempotencyKey",
      "recipientId",
    ]);
    expect(both).toMatchObject({
      idempotencyKey: key,
      recipientId: "fixture-recipient",
    });
  });

  it("sends only the channel's address and ignores other properties of to", () => {
    const to = { email: EMAIL, phone: PHONE, name: "Fixture Name" };
    expect(Object.keys(bodyOf({ ...email, to }))).toEqual([
      "nudgeExternalRef",
      "channel",
      "toEmailAddress",
      "mergeTags",
    ]);
    expect(Object.keys(bodyOf({ ...sms, to }))).toEqual([
      "nudgeExternalRef",
      "channel",
      "toPhoneNumber",
      "mergeTags",
    ]);
    expect(bodyOf({ ...email, to })).toMatchObject({ toEmailAddress: EMAIL });
    expect(bodyOf({ ...sms, to })).toMatchObject({ toPhoneNumber: PHONE });
  });

  it("never sends 0.1.0's fields", () => {
    const body = bodyOf({
      ...email,
      idempotencyKey: placeholderId(1),
      recipientId: "fixture-recipient",
    });
    for (const name of [
      "toName",
      "emailCc",
      "emailBcc",
      "emailAttachments",
      "nudgeId",
      "files",
      "options",
    ]) {
      expect(body).not.toHaveProperty(name);
    }
  });

  it("keeps the merge tags in the input's order", () => {
    expect(
      bodyOf({ ...email, mergeTags: { zeta: "1", alpha: "2", mid: "3" } })
        .mergeTags,
    ).toEqual([
      { tagName: "zeta", tagValue: "1" },
      { tagName: "alpha", tagValue: "2" },
      { tagName: "mid", tagValue: "3" },
    ]);
  });
});

describe("readSendResult", () => {
  it("reads the log id ignoring key case", () => {
    const id = placeholderId(2);
    expect(readSendResult({ NotificationLogId: id })).toEqual({
      accepted: true,
      notificationLogId: id,
    });
    expect(readSendResult({ notificationLogId: id })).toEqual({
      accepted: true,
      notificationLogId: id,
    });
  });

  it("reads a missing, null or empty id as null", () => {
    for (const body of [
      {},
      { NotificationLogId: null },
      { NotificationLogId: "" },
      { NotificationLogId: 5 },
      null,
    ]) {
      expect(readSendResult(body)).toEqual({
        accepted: true,
        notificationLogId: null,
      });
    }
  });
});
