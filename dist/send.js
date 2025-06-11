"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendNudge = sendNudge;
exports.createSendClient = createSendClient;
async function createFileBuffer(file) {
    const buffer = await file.arrayBuffer();
    const uint8Array = new Uint8Array(buffer);
    if (typeof btoa === "function") {
        return await new Blob([buffer]).text();
    }
    else if (typeof Buffer === "function") {
        return Buffer.from(uint8Array).toString("base64");
    }
    else {
        throw new Error("No base64 encoding method available.");
    }
}
async function sendNudge(client, opts) {
    const _mergeTags = opts.mergeTags ?? [];
    const mergeTags = Array.isArray(_mergeTags) ? _mergeTags : Object.entries(_mergeTags).map(([tagName, tagValue]) => ({ tagName, tagValue }));
    const emailAttachments = [];
    if (opts.files?.length) {
        const filePromises = opts.files.map(file => {
            return new Promise((resolve, reject) => {
                createFileBuffer(file).then(text => resolve({ content: text, mimeType: file.type, fileName: file.name })).catch(reject);
            });
        });
        emailAttachments.push(...(await Promise.all(filePromises)));
    }
    const result = await fetch(`${client.baseUrl}/Nudge/Send`, {
        method: "POST",
        headers: {
            accept: "application/json",
            "content-type": "application/json",
            authorization: client.apiKey,
        },
        body: JSON.stringify({
            nudgeId: opts.nudgeId,
            toEmailAddress: opts.recipient.email,
            toName: opts.recipient.name,
            mergeTags,
            channel: 0,
            emailCc: opts.options?.cc?.join(","),
            emailBcc: opts.options?.bcc?.join(","),
            emailAttachments
        })
    });
    if (!result.ok) {
        const error = await result.json();
        return { success: false, error };
    }
    const response = await result.json();
    if (response.error) {
        return { success: false, error: response.error };
    }
    return { success: true };
}
function createSendClient({ baseUrl = "https://app.nudge.net/api/v2", apiKey }) {
    if (typeof fetch !== "function") {
        throw new Error("fetch must exist to use nudge.js.");
    }
    const client = {
        send: async (opts) => {
            return sendNudge({ baseUrl, apiKey }, opts);
        }
    };
    return client;
}
