export { createNudgeClient } from "./client.js";
export { isNudgeError, NudgeError } from "./errors.js";
export { createFakeTransport } from "./fake-transport.js";
export { createHttpTransport, DEFAULT_BASE_URL } from "./http-transport.js";
export type {
  NudgeHttpMethod,
  NudgeRequest,
  NudgeResponse,
  NudgeTransport,
} from "./classify.js";
export type {
  CallOptions,
  NudgeClient,
  NudgeClientOptions,
  NudgePreferences,
  NudgeStats,
} from "./client.js";
export type { NudgeErrorCode } from "./errors.js";
export type {
  FakeNudgeTransport,
  FakeTemplate,
  FakeTransportOptions,
} from "./fake-transport.js";
export type { HttpTransportOptions } from "./http-transport.js";
export type {
  NudgeLogChannel,
  PreferenceChange,
  PreferenceLookup,
  PreferenceUpdate,
  RecipientPreference,
} from "./preferences.js";
export type {
  NudgeRecipient,
  SendByTemplateInput,
  SendResult,
} from "./send.js";
export type {
  NotificationDetails,
  NotificationLogEntry,
  NotificationLogPage,
  StatsQuery,
} from "./stats.js";
export type { NudgeChannel } from "./wire.js";
