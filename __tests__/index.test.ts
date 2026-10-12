import { describe, expect, it } from "vitest";
import * as nudge from "../src/index.js";
import type {
  CallOptions,
  HttpTransportOptions,
  NotificationDetails,
  NotificationLogEntry,
  NotificationLogPage,
  NudgeChannel,
  NudgeClient,
  NudgeClientOptions,
  NudgeErrorCode,
  NudgeHttpMethod,
  NudgeLogChannel,
  NudgePreferences,
  NudgeRecipient,
  NudgeRequest,
  NudgeResponse,
  NudgeStats,
  NudgeTransport,
  PreferenceChange,
  PreferenceLookup,
  PreferenceUpdate,
  RecipientPreference,
  SendByTemplateInput,
  SendResult,
  StatsQuery,
} from "../src/index.js";

// Compile-time check: each type named here must be exported by src/index.ts.
export type PublicTypes = [
  CallOptions,
  HttpTransportOptions,
  NotificationDetails,
  NotificationLogEntry,
  NotificationLogPage,
  NudgeChannel,
  NudgeClient,
  NudgeClientOptions,
  NudgeErrorCode,
  NudgeHttpMethod,
  NudgeLogChannel,
  NudgePreferences,
  NudgeRecipient,
  NudgeRequest,
  NudgeResponse,
  NudgeStats,
  NudgeTransport,
  PreferenceChange,
  PreferenceLookup,
  PreferenceUpdate,
  RecipientPreference,
  SendByTemplateInput,
  SendResult,
  StatsQuery,
];

const RUNTIME_NAMES = [
  "DEFAULT_BASE_URL",
  "NudgeError",
  "createHttpTransport",
  "createNudgeClient",
  "isNudgeError",
];

describe("the public API", () => {
  it("exports exactly the runtime names of the public API", () => {
    expect(Object.keys(nudge).sort()).toEqual([...RUNTIME_NAMES].sort());
  });

  it("points DEFAULT_BASE_URL at production", () => {
    expect(nudge.DEFAULT_BASE_URL).toBe("https://app.nudge.net/api");
  });

  it("drops the 0.1.0 API", () => {
    for (const name of [
      "createClient",
      "createSendClient",
      "sendNudge",
      "listNudges",
    ]) {
      expect(nudge).not.toHaveProperty(name);
    }
  });
});
