/**
 * @file routes/accountRoutes.ts
 * @service pipedream-api
 * @description Express router for Pipedream connected-accounts endpoints.
 *
 * After a user completes OAuth via Pipedream Connect, an account record is
 * created in Pipedream's system.  These routes allow the workflow builder to
 * query which apps a user has already connected so the UI can skip the OAuth
 * step for previously-authenticated apps.
 *
 * Routes:
 *   GET /v1/accounts — List connected accounts for an external user.
 */

import { Router } from "express";
import { getPipedreamClient } from "../pipedream.js";
import { parseLimit } from "../utils/parseLimit.js";
import { logger } from "../logger.js";
import { DEFAULT_ACCOUNT_LIST_LIMIT, MAX_ACCOUNT_LIST_LIMIT } from "../constants.js";

export const accountRouter = Router();

/**
 * GET /v1/accounts
 *
 * Lists Pipedream connected accounts for the given external user, optionally
 * filtered by app slug.  Used by the UI to check if an app is already
 * connected before showing the connect_account widget.
 *
 * Query params:
 *   externalUserId (required) — The user's external id (also accepts external_user_id).
 *   app?                      — Filter to accounts for a specific app slug.
 *   limit?                    — Max results (default 50, max 100).
 *
 * Response: { data: AccountRecord[], hasNextPage: boolean }
 * Each AccountRecord: { id, name, externalId, healthy, dead, app }
 *
 * Note: credentials are intentionally excluded from the response
 * (includeCredentials: false) — this endpoint is safe to call from the browser.
 */
accountRouter.get("/v1/accounts", async (req, res) => {
  // Accept both camelCase and snake_case external user id query params.
  const externalUserId =
    typeof req.query.externalUserId === "string"
      ? req.query.externalUserId
      : typeof req.query.external_user_id === "string"
        ? req.query.external_user_id
        : null;

  if (!externalUserId?.trim()) {
    logger.warn("GET /v1/accounts called without externalUserId", "accountRoutes");
    res.status(400).json({ error: "externalUserId query parameter is required" });
    return;
  }

  const appSlug = typeof req.query.app === "string" ? req.query.app : undefined;
  const limit = parseLimit(req.query.limit, DEFAULT_ACCOUNT_LIST_LIMIT, MAX_ACCOUNT_LIST_LIMIT);

  logger.info(
    `GET /v1/accounts externalUserId="${externalUserId.trim()}" app="${appSlug ?? ""}" limit=${limit}`,
    "accountRoutes",
  );

  try {
    const pd = getPipedreamClient();

    const page = await pd.accounts.list({
      externalUserId: externalUserId.trim(),
      app: appSlug,
      limit,
      includeCredentials: false, // Never expose credentials through this API.
    });

    // Project only the fields the UI needs — avoids leaking sensitive metadata.
    const data = page.data.map((a) => ({
      id: a.id,
      name: a.name,
      externalId: a.externalId,
      healthy: a.healthy,
      dead: a.dead,
      app: a.app,
    }));

    logger.info(
      `GET /v1/accounts returned ${data.length} account(s) for "${externalUserId.trim()}"`,
      "accountRoutes",
    );

    res.json({ data, hasNextPage: page.hasNextPage() });
  } catch (e) {
    logger.error("Failed to list connected accounts", "accountRoutes", e);
    res.status(500).json({
      error: e instanceof Error ? e.message : "Failed to list accounts",
    });
  }
});