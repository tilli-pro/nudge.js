# @tilli.dev/nudge.js

## 0.2.0

### Minor Changes

- 31dc3ed: First release under the name `@tilli.dev/nudge.js`; 0.1.0 was published as `@tilli-pro/nudge.js`.

  Breaking changes from 0.1.0:

  - `createSendClient({ apiKey, baseUrl })` becomes `createNudgeClient({ apiKey, baseUrl? })`;
    `baseUrl` is the API root ending in `/api`, and the routes are appended.
  - `createClient({ apiKey, baseUrl, authCredentials })` and `listNudges()` are removed: the
    client uses an API key only.
  - `send({ nudgeId, recipient: { email }, mergeTags })` becomes `sendByTemplate({ externalRef,
channel, to: { email }, mergeTags })`; a nudge without an external ref gets one in the portal.
  - `recipient.name` is removed: Nudge has no recipient-name field, and `toName` was always
    dropped. Pass a merge tag the template uses.
  - `mergeTags` is a `Record<string, string>` only; the `MergeTag[]` form is removed.
  - `options.cc`, `options.bcc` and `files` are removed; `files` never sent base64 on Node 16
    and later.
  - A failure no longer resolves `{ success: false, error }`; it rejects with `NudgeError`, and
    a success resolves `{ accepted: true, notificationLogId }`.
  - Email only becomes `channel: "email" | "sms"`.
  - A new `idempotencyKey` replaces the absence of any idempotency.
  - The CommonJS output under `"type": "module"` that was committed becomes an ESM build that is
    published only and never committed.
  - The warning printed by `createClient` and the errors logged by `listNudges` are gone: the
    package is silent.
  - The exports `MergeTag`, `EmailRecipient`, `NudgeSendOpts`, `NudgeSendResult`,
    `NudgeSendClient`, `sendNudge`, `ClientCreationOpts`, `AnyFunction` and `UnwrapPromise` are
    removed; the new names replace them.

  Migration:

  1. Create one client per API key at module scope: `createNudgeClient({ apiKey, baseUrl })`.
  2. `baseUrl` is the API root and ends in `/api` (production `https://app.nudge.net/api`, the
     default; staging `https://staging.nudge.net/api`; QA `https://qa.nudge.net/api`). If
     your configuration holds the host only, pass `${host}/api`; never pass the host alone:
     the SDK does not add `/api`.
  3. Replace each request to `.../Nudge/Send` with `await client.sendByTemplate({ externalRef,
channel, to, mergeTags, idempotencyKey })`: one call per channel, with the merge tags as a
     record.
  4. Build the idempotency key from what makes the delivery unique across the whole Nudge account.
  5. A caller that put `RecipientId` in its merge tags passes `recipientId` instead.
  6. A caller of Nudge's v1 Send moves to v2 by the same change; v2 looks the template up per
     channel.
  7. Replace an `if (!result.success)` check with `try`/`catch` on `NudgeError`, branch on `code`,
     and log `code` and `status`, never the input.
  8. A raw `GetNotificationDetails` read becomes
     `client.stats.details({ channel, notificationLogId })`.
  9. Stats reads pass wall time `YYYY-MM-DDTHH:mm:ss` plus `timeZone`, not `toISOString()`.
  10. In tests, pass `transport: createFakeTransport({ templates })` with your own catalogue.
