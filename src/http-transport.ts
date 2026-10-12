import {
  isRecord,
  type NudgeRequest,
  type NudgeResponse,
  type NudgeTransport,
} from "./classify.js";
import { NudgeError } from "./errors.js";

export const DEFAULT_BASE_URL = "https://app.nudge.net/api";

const TRAILING_SLASHES = /\/+$/;

export interface HttpTransportOptions {
  readonly apiKey: string;
  readonly baseUrl?: string;
  readonly fetch?: typeof globalThis.fetch;
}

function isHttpRoot(baseUrl: unknown): boolean {
  if (typeof baseUrl !== "string" || !URL.canParse(baseUrl)) {
    return false;
  }
  const { protocol } = new URL(baseUrl);
  return protocol === "http:" || protocol === "https:";
}

export function assertConnectionOptions(
  operation: string,
  apiKey: unknown,
  baseUrl: unknown,
): void {
  if (typeof apiKey !== "string" || apiKey.trim() === "") {
    throw new NudgeError({ code: "invalid", operation });
  }
  if (baseUrl !== undefined && !isHttpRoot(baseUrl)) {
    throw new NudgeError({ code: "invalid", operation });
  }
}

function buildUrl(
  root: string,
  path: string,
  query: NudgeRequest["query"],
): string {
  const url = `${root}/${path}`;
  if (query !== undefined && Object.keys(query).length > 0) {
    return `${url}?${new URLSearchParams(query).toString()}`;
  }
  return url;
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text === "") {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function createHttpTransport(
  options: HttpTransportOptions,
): NudgeTransport {
  if (!isRecord(options)) {
    throw new NudgeError({ code: "invalid", operation: "createHttpTransport" });
  }
  assertConnectionOptions(
    "createHttpTransport",
    options.apiKey,
    options.baseUrl,
  );
  const { apiKey, baseUrl, fetch: fetchOption } = options;
  const root = (baseUrl ?? DEFAULT_BASE_URL).replace(TRAILING_SLASHES, "");

  return {
    async request(request: NudgeRequest): Promise<NudgeResponse> {
      const hasBody = request.body !== undefined;
      const headers: Record<string, string> = {
        authorization: apiKey,
        accept: "application/json",
      };
      if (hasBody) {
        headers["content-type"] = "application/json";
      }
      const init: RequestInit = {
        method: request.method,
        headers,
        signal: request.signal,
      };
      if (hasBody) {
        init.body = JSON.stringify(request.body);
      }
      const doFetch = fetchOption ?? globalThis.fetch;
      const response = await doFetch(
        buildUrl(root, request.path, request.query),
        init,
      );
      const body = await readBody(response);
      return { status: response.status, headers: response.headers, body };
    },
  };
}
