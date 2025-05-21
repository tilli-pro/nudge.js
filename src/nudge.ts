interface ClientCreationOpts {
  apiKey: string;
  baseUrl?: string;
}

interface NudgeClient {
  apiKey: string;
  baseUrl: string;
  send(opts: NudgeSendOpts): Promise<{ success: boolean; error?: undefined } | { success: false, error: unknown }>;
}

export function createClient({
  baseUrl = "https://app.nudge.net/api/v2",
  apiKey
}: ClientCreationOpts): NudgeClient {
  if(typeof fetch !== "function") {
    throw new Error("fetch must exist to use nudge.js.");
  }
  
  const client: NudgeClient = {
    apiKey,
    baseUrl,
    send: async (opts: NudgeSendOpts) => {
      return sendNudge(client, opts);
    }
  }
  
  return client;
}

interface EmailRecipient {
  email: string;
  name?: string;
}

interface MergeTag {
  tagName: string;
  tagValue: string;
}

interface NudgeSendOpts {
  nudgeId: string;
  recipient: EmailRecipient;
  options?: { cc?: string[]; bcc?: string[] };
  mergeTags?: MergeTag[] | Record<string, string>;
  files?: File[];
}

async function createFileBuffer(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const uint8Array = new Uint8Array(buffer);
  if(typeof btoa === "function") {
    return await new Blob([buffer]).text();
  } else if (typeof Buffer === "function") {
    return Buffer.from(uint8Array).toString("base64");
  } else {
    throw new Error("No base64 encoding method available.");
  }
}

async function sendNudge(
  client: NudgeClient,
  opts: NudgeSendOpts
) {
  const _mergeTags = opts.mergeTags ?? [];
  const mergeTags = Array.isArray(_mergeTags) ? _mergeTags : Object.entries(_mergeTags).map(([tagName, tagValue]) => ({ tagName, tagValue }));
  
  const emailAttachments = [];
  
  if(opts.files?.length) {
    const filePromises = opts.files.map(file => {
      return new Promise<{ content: string; mimeType: string; fileName: string; }>((resolve, reject) => {
        createFileBuffer(file).then(text => resolve({ content: text, mimeType: file.type, fileName: file.name })).catch(reject);
      })
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