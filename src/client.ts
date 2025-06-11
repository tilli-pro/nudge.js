import { BASE_PROD_URL } from "./config";
import { sendNudge } from "./send";
import type { NudgeSendClient, NudgeSendOpts, NudgeSendResult } from "./send";
import { AnyFunction, UnwrapPromise } from "./types";

interface NudgeBaseResponse<T> {
  data: T | null;
  code: number;
  errCode: number;
  errors: string[];
  hasErrors: boolean;
  errorGuid: string;
}

export interface ClientCreationOpts {
  apiKey: string;
  baseUrl?: string;
  authCredentials: {
    email: string;
    password: string;
  }
}

interface NudgeListOpts {
  top?: number;
  orderBy?: "ScheduleOn desc" | "ScheduleOn asc";
}

interface NudgeListResponse {
  pageData: {
    id: number,
    nudgeName: string;
    insensitiveName: string;
    description: string | null;
    scheduledOn: string; // ISO 8601 date string
    createdOn: string; // ISO 8601 date string
    status: number;
    nudgeType: number;
    templateId: number;
    sendWithoutRecipient: boolean;
    projectName: string | null;
    insensitiveProjectName: string | null;
    lastModifiedByUser: string;
    insensitiveLastModifiedByUser: string;
    modifiedDate: string; // ISO 8601 date string
  }[];
  totalCount: number;
  errors: number;
}

interface NudgeClient extends NudgeSendClient {
  listNudges: (opts?: NudgeListOpts) => Promise<NudgeBaseResponse<NudgeListResponse>>;
}

export function createClient({
  baseUrl = BASE_PROD_URL,
  apiKey,
  authCredentials
}: ClientCreationOpts): NudgeClient {
  if(typeof fetch !== "function") {
    throw new Error("fetch must exist to use nudge.js.");
  } else if (baseUrl.endsWith("/")) {
    baseUrl = baseUrl.slice(0, -1); // Remove trailing slash if present
  }
  
  let bearerToken: string | null = null;
  
  const $connect = async () => {
    try {
      const signInResponse = await fetch(`${baseUrl}/Session/SignIn`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        body: JSON.stringify({
          email: authCredentials.email,
          password: authCredentials.password,
          keepMeSignedIn: false
        }),
      });
      
      if (!signInResponse.ok) {
        throw new Error("Failed to sign in to Nudge API.");
      }
      const signInData = (await signInResponse.json()) as NudgeBaseResponse<{
        jwtToken: string
      }>;
      
      if (signInData.hasErrors || !signInData.data || !signInData.data.jwtToken) {
        throw new Error("Failed to sign in to Nudge API: " + signInData.errors.join(", "));
      }
      
      bearerToken = signInData.data.jwtToken;
      return true;
    } catch(e) {
      console.error("Error connecting to Nudge API:", e);
    }
    
    return false;
  };
  
  let connectionPromise: ReturnType<typeof $connect> | null = null;
  
  const checkConnected = <T extends AnyFunction>(fn: T) => async (
    ...args: Parameters<T>
  ): Promise<UnwrapPromise<ReturnType<T>>> => {
    if (!connectionPromise && !bearerToken) {
      connectionPromise = $connect();
    }
    const result = await connectionPromise;
    
    if (!bearerToken || !result) {
      throw new Error("Not connected to Nudge API.");
    }
    
    return fn(...args);
  }
  
  console.warn("The Nudge API client is currently undergoing active development. The vast majority of API features are not yet implemented. Please use with caution and report any issues you encounter.");
  
  return {
    send: (opts) => sendNudge({ baseUrl, apiKey }, opts),
    listNudges: checkConnected(async (opts?: NudgeListOpts) => {
      const apiUrl = `${baseUrl}/api/EmailNudge/List`;
      const params = new URLSearchParams();
      
      // TODO: What validations exist for these options?
      if (opts?.top) {
        params.append("top", opts.top.toString());
      }
      if (opts?.orderBy) {
        params.append("orderBy", opts.orderBy);
      }
      const stringParams = params.toString()
      const url = stringParams ? `${apiUrl}?${stringParams}` : apiUrl;
      
      const listResponse = await fetch(url, {
        method: "GET",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${bearerToken}`,
        }
      });
      
      return listResponse.json() as Promise<NudgeBaseResponse<NudgeListResponse>>;
    })
  }
}