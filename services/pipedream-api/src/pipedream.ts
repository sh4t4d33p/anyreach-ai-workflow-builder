/**
 * @file pipedream.ts
 * @service pipedream-api
 * @description Singleton factory for the Pipedream server-side SDK client.
 *
 * The PipedreamClient is initialised once at first call and reused for all
 * subsequent requests.  This avoids re-reading environment variables and
 * re-constructing the client on every HTTP request.
 *
 * Why a singleton?
 *  - The Pipedream SDK uses OAuth2 machine-to-machine credentials that are
 *    read at construction time.  Reusing a single instance keeps the token
 *    refresh lifecycle consistent across requests.
 *  - The client is thread-safe for concurrent requests (each SDK call is
 *    independent and carries its own request context).
 *
 * Required environment variables:
 *  PIPEDREAM_CLIENT_ID           — OAuth client id for M2M auth.
 *  PIPEDREAM_CLIENT_SECRET       — OAuth client secret (never exposed to browser).
 *  PIPEDREAM_PROJECT_ID          — Your Pipedream project identifier.
 *  PIPEDREAM_PROJECT_ENVIRONMENT — "development" or "production".
 */

import { PipedreamClient, type ProjectEnvironment } from "@pipedream/sdk";
import { logger } from "./logger.js";

/**
 * Reads a required environment variable and throws a descriptive error if
 * it is missing or empty.
 *
 * Why not optional?: All four Pipedream credentials are mandatory — the
 * server cannot function without them.  Failing fast at startup with a clear
 * message is better than a confusing auth error later.
 *
 * @param name  The environment variable name.
 * @returns     The variable's trimmed value.
 * @throws      Error if the variable is absent or empty.
 */
function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v?.trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return v.trim();
}

/**
 * Reads and validates PIPEDREAM_PROJECT_ENVIRONMENT.
 *
 * Only "development" and "production" are valid — Pipedream Connect behaves
 * differently in each environment (OAuth redirect URLs, credential scopes).
 *
 * @returns The validated ProjectEnvironment value.
 * @throws  Error if the value is anything other than "development" or "production".
 */
function resolveProjectEnvironment(): ProjectEnvironment {
  const raw = (process.env.PIPEDREAM_PROJECT_ENVIRONMENT ?? "development").toLowerCase();

  if (raw === "production" || raw === "development") {
    return raw;
  }

  throw new Error(
    `PIPEDREAM_PROJECT_ENVIRONMENT must be "development" or "production", got "${raw}"`,
  );
}

/** Module-level singleton — initialised on first call to getPipedreamClient(). */
let client: PipedreamClient | null = null;

/**
 * Returns the singleton PipedreamClient, constructing it on first call.
 *
 * Reads all four required environment variables at construction time.
 * Throws descriptively if any are missing so the developer knows exactly
 * which variable to set.
 *
 * @returns An authenticated PipedreamClient ready for SDK calls.
 * @throws  Error if any required environment variable is missing.
 */
export function getPipedreamClient(): PipedreamClient {
  if (client) {
    return client;
  }

  logger.info("Initialising Pipedream client (first call)", "pipedream");

  const projectEnvironment = resolveProjectEnvironment();

  client = new PipedreamClient({
    clientId: requireEnv("PIPEDREAM_CLIENT_ID"),
    clientSecret: requireEnv("PIPEDREAM_CLIENT_SECRET"),
    projectId: requireEnv("PIPEDREAM_PROJECT_ID"),
    projectEnvironment,
  });

  logger.info(
    `Pipedream client initialised for environment="${projectEnvironment}"`,
    "pipedream",
  );

  return client;
}
