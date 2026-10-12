import {
  classifyNoResponse,
  classifyResponse,
  type NudgeRequestSpec,
  type NudgeResponse,
  type NudgeTransport,
} from "./classify.js";
import { NudgeError } from "./errors.js";
import { createHttpTransport } from "./http-transport.js";
import {
  type PreferenceLookup,
  type PreferenceLookupOperation,
  type PreferenceUpdate,
  preferenceLookupRequest,
  preferenceUpdateRequest,
  type RecipientPreference,
  readPreferenceList,
  readUpdateAccepted,
} from "./preferences.js";
import {
  readSendResult,
  type SendByTemplateInput,
  type SendResult,
  sendRequest,
} from "./send.js";
import {
  type NotificationDetails,
  type NotificationLogPage,
  readDetails,
  readLogPage,
  type StatsDetailsInput,
  type StatsQuery,
  statsDetailsRequest,
  statsListRequest,
} from "./stats.js";
import {
  validateClientOptions,
  validatePreferenceLookup,
  validatePreferenceUpdate,
  validateSendInput,
  validateStatsDetails,
  validateStatsQuery,
} from "./validate.js";

export interface CallOptions {
  readonly signal?: AbortSignal;
}

export interface NudgeClientOptions {
  /** The Authorization value; never logged. */
  readonly apiKey: string;
  /** API root; DEFAULT_BASE_URL. */
  readonly baseUrl?: string;
  /** Per request, applied by the client to any transport; 10_000. */
  readonly timeoutMs?: number;
  /** Builds the default HTTP transport only; globalThis.fetch. */
  readonly fetch?: typeof globalThis.fetch;
  /**
   * Replaces the HTTP transport (tests: createFakeTransport); not with fetch.
   */
  readonly transport?: NudgeTransport;
}

export interface NudgeStats {
  list(query: StatsQuery, options?: CallOptions): Promise<NotificationLogPage>;
  details(
    input: StatsDetailsInput,
    options?: CallOptions,
  ): Promise<NotificationDetails>;
}

export interface NudgePreferences {
  get(
    lookup: PreferenceLookup,
    options?: CallOptions,
  ): Promise<readonly RecipientPreference[]>;
  history(
    lookup: PreferenceLookup,
    options?: CallOptions,
  ): Promise<readonly RecipientPreference[]>;
  update(update: PreferenceUpdate, options?: CallOptions): Promise<void>;
}

export interface NudgeClient {
  sendByTemplate(
    input: SendByTemplateInput,
    options?: CallOptions,
  ): Promise<SendResult>;
  readonly stats: NudgeStats;
  readonly preferences: NudgePreferences;
}

const DEFAULT_TIMEOUT_MS = 10_000;

export function createNudgeClient(options: NudgeClientOptions): NudgeClient {
  validateClientOptions(options);
  const transport: NudgeTransport =
    options.transport ??
    createHttpTransport({
      apiKey: options.apiKey,
      ...(options.baseUrl === undefined ? {} : { baseUrl: options.baseUrl }),
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    });
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  async function execute(
    spec: NudgeRequestSpec,
    callOptions: CallOptions | undefined,
  ): Promise<NudgeResponse> {
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const callerSignal = callOptions?.signal;
    const signal =
      callerSignal === undefined
        ? timeoutSignal
        : AbortSignal.any([timeoutSignal, callerSignal]);
    let response: NudgeResponse;
    try {
      response = await transport.request({ ...spec, signal });
    } catch (error) {
      throw classifyNoResponse(
        spec.operation,
        error,
        callerSignal,
        timeoutSignal,
      );
    }
    const failure = classifyResponse(spec.operation, response);
    if (failure !== null) throw failure;
    return response;
  }

  async function read<T>(
    spec: NudgeRequestSpec,
    callOptions: CallOptions | undefined,
    reader: (body: unknown) => T | undefined | false,
  ): Promise<T> {
    const response = await execute(spec, callOptions);
    const value = reader(response.body);
    if (value === undefined || value === false) {
      throw new NudgeError({
        code: "server",
        operation: spec.operation,
        status: response.status,
      });
    }
    return value;
  }

  function lookup(
    operation: PreferenceLookupOperation,
  ): (
    input: PreferenceLookup,
    callOptions?: CallOptions,
  ) => Promise<readonly RecipientPreference[]> {
    return async (input, callOptions) => {
      validatePreferenceLookup(operation, input);
      return await read(
        preferenceLookupRequest(operation, input),
        callOptions,
        readPreferenceList,
      );
    };
  }

  return {
    async sendByTemplate(input, callOptions) {
      validateSendInput(input);
      return await read(sendRequest(input), callOptions, readSendResult);
    },
    stats: {
      async list(query, callOptions) {
        validateStatsQuery(query);
        return await read(statsListRequest(query), callOptions, readLogPage);
      },
      async details(input, callOptions) {
        validateStatsDetails(input);
        return await read(statsDetailsRequest(input), callOptions, readDetails);
      },
    },
    preferences: {
      get: lookup("preferences.get"),
      history: lookup("preferences.history"),
      async update(update, callOptions) {
        validatePreferenceUpdate(update);
        await read(
          preferenceUpdateRequest(update),
          callOptions,
          readUpdateAccepted,
        );
      },
    },
  };
}
