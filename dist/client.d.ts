import type { NudgeSendClient } from "./send";
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
    };
}
interface NudgeListOpts {
    top?: number;
    orderBy?: "ScheduleOn desc" | "ScheduleOn asc";
}
interface NudgeListResponse {
    pageData: {
        id: number;
        nudgeName: string;
        insensitiveName: string;
        description: string | null;
        scheduledOn: string;
        createdOn: string;
        status: number;
        nudgeType: number;
        templateId: number;
        sendWithoutRecipient: boolean;
        projectName: string | null;
        insensitiveProjectName: string | null;
        lastModifiedByUser: string;
        insensitiveLastModifiedByUser: string;
        modifiedDate: string;
    }[];
    totalCount: number;
    errors: number;
}
interface NudgeClient extends NudgeSendClient {
    listNudges: (opts?: NudgeListOpts) => Promise<NudgeBaseResponse<NudgeListResponse>>;
}
export declare function createClient({ baseUrl, apiKey, authCredentials }: ClientCreationOpts): NudgeClient;
export {};
