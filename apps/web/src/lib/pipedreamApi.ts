/**
 * @file lib/pipedreamApi.ts
 * @app web
 * @description Network layer for the pipedream-api service.
 *
 * Encapsulates all fetch calls to the pipedream-api so that components never
 * contain raw fetch logic, HTTP status parsing, or JSON casting.
 *
 * Separation of concerns:
 *  - This file owns: HTTP transport, error extraction, response typing.
 *  - Callers own: React state, UI feedback, SDK plumbing.
 */

import type { CreateTokenResponse } from "@pipedream/sdk/browser";

/**
 * Fetches a short-lived Pipedream Connect token from the pipedream-api service.
 *
 * How it works:
 *  1. POST to `<apiBase>/v1/connect/tokens` with the external user id.
 *  2. Parse the JSON response.
 *  3. Throw a descriptive Error on any non-2xx status.
 *  4. Return a `CreateTokenResponse` shaped object for the Pipedream frontend SDK.
 *
 * Why: The Pipedream frontend SDK requires a `tokenCallback` on the client
 * instance.  Keeping the fetch here means the `useMemo` in App.tsx stays clean
 * and this logic is independently testable.
 *
 * @param apiBase       Base URL of the pipedream-api service (e.g. "http://localhost:3001").
 * @param externalUserId  The external user id to associate the token with.
 * @returns               Token, expiry, and connect link as expected by the SDK.
 * @throws                Error with a user-readable message on network or API failure.
 */
export async function fetchConnectToken(
  apiBase: string,
  externalUserId: string,
): Promise<CreateTokenResponse> {
  console.log("[pipedreamApi] fetchConnectToken — externalUserId:", externalUserId);

  const res = await fetch(`${apiBase}/v1/connect/tokens`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ externalUserId }),
  });

  if (!res.ok) {
    const errText = await res.text();
    const errMsg = errText || `Token request failed (HTTP ${res.status})`;
    console.error("[pipedreamApi] fetchConnectToken — server error", { status: res.status, errMsg });
    throw new Error(errMsg);
  }

  const body = (await res.json()) as {
    token: string;
    expiresAt: string;
    connectLinkUrl: string;
  };

  if (!body.token) {
    throw new Error("fetchConnectToken: no token in response");
  }

  console.log("[pipedreamApi] fetchConnectToken — success, expires:", body.expiresAt);

  return {
    token: body.token,
    expiresAt: new Date(body.expiresAt),
    connectLinkUrl: body.connectLinkUrl,
  };
}
