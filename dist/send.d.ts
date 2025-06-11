import type { ClientCreationOpts } from "./client";
export interface NudgeSendOpts {
    nudgeId: string;
    recipient: EmailRecipient;
    options?: {
        cc?: string[];
        bcc?: string[];
    };
    mergeTags?: MergeTag[] | Record<string, string>;
    files?: File[];
}
export type NudgeSendResult = {
    success: boolean;
    error?: undefined;
} | {
    success: false;
    error: unknown;
};
export interface NudgeSendClient {
    send(opts: NudgeSendOpts): Promise<NudgeSendResult>;
}
export interface EmailRecipient {
    email: string;
    name?: string;
}
export interface MergeTag {
    tagName: string;
    tagValue: string;
}
export declare function sendNudge(client: SendClientCreationOpts, opts: NudgeSendOpts): Promise<NudgeSendResult>;
type SendClientCreationOpts = Omit<ClientCreationOpts, "authCredentials">;
export declare function createSendClient({ baseUrl, apiKey }: SendClientCreationOpts): NudgeSendClient;
export {};
