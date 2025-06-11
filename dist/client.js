"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createClient = createClient;
const config_1 = require("./config");
const send_1 = require("./send");
function createClient({ baseUrl = config_1.BASE_PROD_URL, apiKey, authCredentials }) {
    if (typeof fetch !== "function") {
        throw new Error("fetch must exist to use nudge.js.");
    }
    else if (baseUrl.endsWith("/")) {
        baseUrl = baseUrl.slice(0, -1); // Remove trailing slash if present
    }
    let bearerToken = null;
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
            const signInData = (await signInResponse.json());
            if (signInData.hasErrors || !signInData.data || !signInData.data.jwtToken) {
                throw new Error("Failed to sign in to Nudge API: " + signInData.errors.join(", "));
            }
            bearerToken = signInData.data.jwtToken;
            return true;
        }
        catch (e) {
            console.error("Error connecting to Nudge API:", e);
        }
        return false;
    };
    let connectionPromise = null;
    const checkConnected = (fn) => async (...args) => {
        if (!connectionPromise && !bearerToken) {
            connectionPromise = $connect();
        }
        if (connectionPromise) {
            const result = await connectionPromise;
            if (!bearerToken || !result) {
                throw new Error("Not connected to Nudge API.");
            }
        }
        try {
            return fn(...args);
        }
        catch (e) {
            if (e instanceof Error && e.message.includes("Unauthorized")) {
                bearerToken = null;
            }
            throw e;
        }
    };
    console.warn("The Nudge API client is currently undergoing active development. The vast majority of API features are not yet implemented. Please use with caution and report any issues you encounter.");
    return {
        send: (opts) => (0, send_1.sendNudge)({ baseUrl, apiKey }, opts),
        listNudges: checkConnected(async (opts) => {
            const apiUrl = `${baseUrl}/api/EmailNudge/List`;
            const params = new URLSearchParams();
            // TODO: What validations exist for these options?
            if (opts?.top) {
                params.append("top", opts.top.toString());
            }
            if (opts?.orderBy) {
                params.append("orderBy", opts.orderBy);
            }
            const stringParams = params.toString();
            const url = stringParams ? `${apiUrl}?${stringParams}` : apiUrl;
            const listResponse = await fetch(url, {
                method: "GET",
                headers: {
                    accept: "application/json",
                    authorization: `Bearer ${bearerToken}`,
                }
            });
            return listResponse.json();
        })
    };
}
