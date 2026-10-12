# @tilli.dev/nudge.js

A typed TypeScript client for the [Nudge](https://nudge.net) API: send a message by template over email or
SMS, read delivery stats, and read and change recipient preferences. Every failure is one typed error, and
tests run against a fake transport with no network.

## Install

```sh
pnpm add @tilli.dev/nudge.js
```

Node 22 or later. The package is ESM only: load it with `import`. It is for servers only, because the API key
is a secret that must never reach a browser. It has no runtime dependencies.

## Client

Create one client per API key, at module scope, and share it:

```typescript
import { createNudgeClient } from "@tilli.dev/nudge.js";

const apiKey = process.env.NUDGE_API_KEY;
if (apiKey === undefined) throw new Error("NUDGE_API_KEY is not set");

export const nudge = createNudgeClient({ apiKey, baseUrl: process.env.NUDGE_BASE_URL });
```

| Option | Default | Meaning |
|---|---|---|
| `apiKey` | required | The raw key, without a `Bearer ` prefix. It is never logged. |
| `baseUrl` | `DEFAULT_BASE_URL`, `https://app.nudge.net/api` | The API root, which ends in `/api`. The SDK appends the versioned routes. |
| `timeoutMs` | 10 seconds (`10_000`) | The limit for each request, applied to any transport. |
| `fetch` | `globalThis.fetch` | Builds the default HTTP transport only. Not allowed together with `transport`. |
| `transport` | the HTTP transport | Replaces the HTTP transport. Tests pass `createFakeTransport(...)`. |

The API roots are production `https://app.nudge.net/api` (the default), staging `https://staging.nudge.net/api`
and QA `https://qa.nudge.net/api`. A root without `/api` reaches no route: Nudge answers 404 and the call
fails as `invalid`.

`apiKey` is the raw key exactly as Nudge issued it: the transport sends it unchanged as the `authorization`
header value, which is what Nudge's API accepts. Do not add `Bearer `: a key with an internal space, or any
character that is not a visible ASCII one, is refused as `invalid`, so
`createNudgeClient({ apiKey: "Bearer abc" })` throws.

Options are checked when the client is created: a bad option throws a `NudgeError` with code `invalid` at once.
Every method takes an optional `{ signal }` as its last argument. Aborting that signal rejects the call with
the signal's own reason, untouched.

`createHttpTransport({ apiKey, baseUrl, fetch })` builds the transport the client uses by default. It moves
bytes and never classifies a status; the client does that, so every transport behaves the same.

## Send

```typescript
const result = await nudge.sendByTemplate({
  externalRef: "welcome",
  channel: "email",
  to: { email: "recipient@example.com" },
  mergeTags: { firstName: "Sam", link: "https://example.com/start" },
  idempotencyKey: "billing-service:production:welcome:user-42:email",
  recipientId: "user-42",
});
// { accepted: true, notificationLogId: "00000000-0000-4000-8000-000000000001" }
```

- `externalRef` is the template's `NudgeExternalRef`. Nudge looks it up per channel, so the email record and
  the SMS record are separate and share the ref.
- One call sends one channel to one recipient. Two channels are two calls. An address or number with a comma
  is refused as `invalid`, because Nudge would split it into several recipients.
- `to` is `{ email }` for `"email"` and `{ phone }` for `"sms"`; other properties of `to` are ignored and never
  sent. A phone number carries its country code, for example `+15550100001`, and Nudge checks it against the
  account's country.
- `mergeTags` is a record of tag names, without `%`, to string values. Names are unique ignoring case.
  Nudge refuses the tags it generates itself (such as `Unsubscribe`, `ManagePreferences` and `PaymentUrl`),
  and refuses a call that omits a tag the template uses. Extra tags are accepted.
- `recipientId` is stored on the log and keys Nudge's per-recipient rate limit; without it the address does.
- A resolved send means Nudge accepted it, not that it was delivered. Read delivery from the stats.
  `notificationLogId` is the log Nudge created, or `null` when the answer carried none.

## Idempotency

An idempotency key makes a retry safe: a repeat of a send that already succeeded answers the first send's log
id instead of sending again.

- The caller generates the key; the SDK never does. A random key made inside the SDK would be different on
  every retry and protect nothing. A key is 1 to 200 characters and not blank; anything else is refused as
  `invalid` before a request is made.
- Nudge scopes a key to the whole account, across every ref and channel. Every caller and every deployment that
  uses the same Nudge account shares that space, so a key must be unique account-wide, not only within the
  caller's own database: prefix it with the consumer and its deployment, and build it from a value that
  survives a database reset where ids restart. For example `billing-service:production:<invoice id>:<channel>`.
- Nudge keeps a key five minutes by default, and records it only after a successful send. A failed send is
  not recorded, so its retry sends again, and two overlapping attempts with the same key can both send.
- That window is not durable deduplication. A caller that must send once keeps its own record of what it
  sent, and treats the key as protection for a quick retry only.
- A retry passes the same key, and retries only an error whose `retryable` is `true` (see Errors).

## Stats

```typescript
const page = await nudge.stats.list({
  channel: "email",
  timeZone: "America/New_York",
  email: "recipient@example.com",
  from: "2026-10-11T00:00:00",
  to: "2026-10-11T23:59:59",
  top: 50,
});
for (const entry of page.entries) {
  console.log(entry.notificationLogId, entry.statusText, entry.scheduledOn);
}
```

- `from` and `to` are wall time in `timeZone` (an IANA name), written `YYYY-MM-DDTHH:mm:ss`. Do not pass
  `toISOString()`: it carries a `Z` and milliseconds and no zone. The times in the entries are wall time in
  the same zone.
- Nudge returns the logs scheduled in `[from, to + 24 hours)`: it adds a day after `to`. The SDK sends `to`
  unchanged and does not compensate, so filter the entries if you need a hard end. Without `from` the window
  starts 7 days ago; without `to` it ends 24 hours from now.
- `top` is 1 to 100 (Nudge's default is 10) and `skip` is 0 or more. Nudge's `totalCount` counts the returned
  page, not the matches, so the page does not expose it: page until `entries.length < top`.
- `phone` is sent as its digits only, because Nudge stores logged numbers bare and matches them exactly.
  `status` is Nudge's `NotificationLogStatus` number. `notificationLogId` and `recipientId` filter by id.

```typescript
const details = await nudge.stats.details({
  channel: "email",
  notificationLogId: "00000000-0000-4000-8000-000000000001",
});
// details.status, details.paymentUrl, details.customFields, details.mergeTags
```

`mergeTags` of the details is `[]` when Nudge has archived the log and sends `null`.

## Preferences

```typescript
const current = await nudge.preferences.get({ recipientId: "user-42" });
const history = await nudge.preferences.history({ recipientId: "user-42" });

await nudge.preferences.update({
  recipientId: "user-42",
  email: "recipient@example.com",
  changes: [
    { preferenceType: "newsletter", email: true, sms: false, unsubscribeReason: "too many messages" },
  ],
  consentDate: "2026-10-11T09:00:00Z",
});
```

- `get` and `history` resolve a list of `{ preferenceType, channel, isSubscribed, … }`. `channel` is lower-case
  and one of `email`, `sms`, `whatsapp`, `push` and `ivr`; a preference on any other channel is left out.
- `update` needs at least one of `recipientId`, `email` and `phone`, and at least one change. Pass a phone
  number with its country code. `preferenceType` is a category's external preference ref, or its name. An
  unknown category rejects as `invalid`.
- `unsubscribeReason` is at most 100 characters. `consentDate` is a UTC time (`2026-10-11T09:00:00Z`).
  `update` resolves `undefined`.

## Errors

Every failure rejects with a `NudgeError`; nothing resolves a failure. Branch on `code`:

| Code | Meaning | Retryable |
|---|---|---|
| `unauthorized` | The key is missing, unknown, or not allowed from this IP address. | no |
| `not-found` | The ref has no active nudge on that channel, or the log id is unknown. | no |
| `invalid` | Refused as malformed or not permitted: merge tags, phone numbers, account limits, balance, an unknown route. | no |
| `rejected` | Nudge created the log but refused the recipient: failed, unsubscribed or suppressed. | no |
| `conflict` | Reserved: no route in this version answers 409. | no |
| `rate-limited` | The account's or the recipient's limit. | yes |
| `server` | Nudge failed, or answered a success it could not have meant. | yes |
| `network` | No response arrived. The outcome is unknown and Nudge may have sent. | yes |
| `timeout` | No response within `timeoutMs`. The outcome is unknown and Nudge may have sent. | yes |

```typescript
import { isNudgeError } from "@tilli.dev/nudge.js";

try {
  await nudge.sendByTemplate(input);
} catch (error) {
  if (!isNudgeError(error)) throw error;
  logger.warn({ code: error.code, status: error.status, operation: error.operation });
}
```

- A `NudgeError` has `code`, `operation` (`send`, `stats.list`, `preferences.update`, …), `status` (the HTTP
  status, `null` when no response arrived), `retryable`, `retryAfterSeconds` (from `Retry-After`; Nudge sends
  none today), `nudgeErrCode` (Nudge's own error number, when the body carries one) and `notificationLogId` (the
  log behind a `rejected` send).
- `serverMessage` is Nudge's own text and may name the recipient. It is defined non-enumerable, so error
  serialisers do not copy it into logs; read it deliberately. The `message` is only
  `nudge <operation>: <code>`, plus ` (HTTP <status>)` when there is a status.
- `retryable` is a fact, not a schedule: the same call with the same key may succeed later. For `network` and
  `timeout` the first attempt may also have succeeded. The SDK retries nothing and keeps no queue.
- Aborting a call through its `signal` rejects with the signal's reason, not with a `NudgeError`.
- `isNudgeError(value)` is a brand check that holds across copies of the package.

## Testing with the fake transport

`createFakeTransport` stands in for Nudge. It checks each send against a catalogue you declare, one entry per
Nudge record:

```typescript
import { createFakeTransport, createNudgeClient, type FakeTemplate } from "@tilli.dev/nudge.js";

const templates = [
  { externalRef: "welcome", channel: "email", mergeTags: ["firstName", "link"] },
  { externalRef: "welcome", channel: "sms", mergeTags: ["firstName"] },
  { externalRef: "receipt", channel: "email", mergeTags: [] },
] as const satisfies readonly FakeTemplate[];

const fake = createFakeTransport({ templates });
const client = createNudgeClient({ apiKey: "test-api-key", transport: fake });

await client.sendByTemplate({
  externalRef: "welcome",
  channel: "email",
  to: { email: "recipient@example.com" },
  mergeTags: { firstName: "Sam", link: "https://example.com/start" },
});
// fake.sent holds the send as it reached the wire; fake.requests holds every request.
```

- An unknown ref and channel rejects as `not-found`; a tag set that differs from the template's rejects as
  `invalid`. A repeated `idempotencyKey` answers the first send's log id and is recorded once. Log ids count up
  from `00000000-0000-4000-8000-000000000001`.
- `sent` holds the accepted first sends, read back from the wire body, so a test also checks the SDK's wire
  mapping; it has no recipient name. `requests` holds every request, in order.
- `intercept` returns a response for a request, or `undefined` to let the fake answer. Use it to reach any
  error code, and throw from it to get `network`:

```typescript
const throttled = createFakeTransport({
  templates,
  intercept: (request) =>
    request.operation === "send" ? { status: 429, headers: new Headers(), body: null } : undefined,
});
```

- Every operation other than `send` answers `invalid` until you script it with `intercept`.
- The fake is stricter than Nudge on purpose: it compares refs and tag names exactly and requires equal tag
  sets, where Nudge ignores case in refs and accepts extra tags. A test that passes on the fake implies Nudge
  accepts the call when the records exist as declared; the converse need not hold. Check the records
  themselves with a real send.
- The fake uses no timer and no randomness, and `timeoutMs` applies to it as to any transport.

## Migrating from 0.1.0

0.1.0 was published as `@tilli-pro/nudge.js`, which this package replaces. 0.2.0 breaks the API:

| 0.1.0 | 0.2.0 |
|---|---|
| `createSendClient({ apiKey, baseUrl = ".../api/v2" })` | `createNudgeClient({ apiKey, baseUrl? })`; `baseUrl` is the API root (`.../api`) and routes are appended |
| `createClient({ apiKey, baseUrl, authCredentials })`, `listNudges()` | removed: the client uses an API key only |
| `send({ nudgeId, recipient: { email }, mergeTags })` | `sendByTemplate({ externalRef, channel: "email", to: { email }, mergeTags })`; a nudge without an external ref gets one in the portal |
| `recipient.name` | removed: Nudge has no recipient-name field (`toName` was always dropped); pass a merge tag the template uses |
| `mergeTags: MergeTag[] \| Record<string, string>` | `Record<string, string>` only |
| `options.cc`, `options.bcc`, `files` | removed; `files` never sent base64 on Node 16 and later |
| resolves `{ success: false, error }` on failure | rejects with `NudgeError`; resolves `{ accepted: true, notificationLogId }` |
| email only | `channel: "email" \| "sms"` |
| no idempotency | `idempotencyKey` |
| CommonJS output under `"type": "module"`, committed | ESM build, published only, never committed |
| a warning printed by `createClient`; errors logged by `listNudges` | silent |
| exports `MergeTag`, `EmailRecipient`, `NudgeSendOpts`, `NudgeSendResult`, `NudgeSendClient`, `sendNudge`, `ClientCreationOpts`, `AnyFunction`, `UnwrapPromise` | removed; the names in this page replace them |

To move a caller:

1. Create one client per API key at module scope: `createNudgeClient({ apiKey, baseUrl })`.
2. `baseUrl` is the API root and ends in `/api` (production `https://app.nudge.net/api`, the default; staging
   `https://staging.nudge.net/api`; QA `https://qa.nudge.net/api`). If your configuration holds the host only, pass
   `${host}/api`; never pass the host alone: the SDK does not add `/api`.
3. Replace each request to `…/Nudge/Send` with `await client.sendByTemplate({ externalRef, channel, to, mergeTags,
   idempotencyKey })`: one `sendByTemplate` call per channel, with the merge tags as a record.
4. Build the idempotency key from what makes the delivery unique across the whole Nudge account (see
   Idempotency).
5. A caller that put `RecipientId` in its merge tags passes `recipientId` instead.
6. A caller of Nudge's v1 Send moves to v2 by the same change; v2 looks the template up per channel.
7. Replace an `if (!result.success)` check with `try`/`catch` on `NudgeError`, branch on `code`, and log `code`
   and `status`, never the input.
8. A raw `GetNotificationDetails` read becomes `client.stats.details({ channel, notificationLogId })`.
9. Stats reads pass wall time `YYYY-MM-DDTHH:mm:ss` plus `timeZone`, not `toISOString()`.
10. In tests, pass `transport: createFakeTransport({ templates })` with your own catalogue.

## Security notes

- The API key lives only inside the HTTP transport's closure. It is sent raw in the `authorization` header, as
  Nudge expects, and is never logged, returned or attached to an error.
- The SDK writes nothing to the console and takes no logger.
- An error carries no request input, and its `message` never holds Nudge's text, a recipient, a merge-tag
  value or the key. Nudge's text is on the non-enumerable `serverMessage`; treat it as possibly naming the
  recipient.
- Use the package on a server. Never put the key in code that ships to a browser or in a repository.

## Licence

MIT. See `LICENSE`.
