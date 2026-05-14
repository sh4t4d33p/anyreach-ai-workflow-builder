/**
 * @file routes/connectRoutes.ts
 * @service pipedream-api
 * @description Express router for Pipedream Connect token endpoints.
 *
 * Pipedream Connect allows end-users to authenticate third-party apps (Slack,
 * Google Sheets, etc.) via OAuth without exposing your platform credentials.
 * The browser SDK requires a short-lived token issued by this server to
 * initiate the OAuth flow.  This router provides that token endpoint.
 *
 * Routes:
 *   POST /v1/connect/tokens  — Create a short-lived Connect token for a user.
 */

import { Router } from "express";
import { getPipedreamClient } from "../pipedream.js";
import { logger } from "../logger.js";

export const connectRouter = Router();

/**
 * POST /v1/connect/tokens
 *
 * Issues a short-lived Pipedream Connect token for the given external user.
 * The browser SDK uses this token to open the OAuth popup; it is single-use
 * and expires quickly so it is safe to pass to an untrusted browser.
 *
 * Request body:
 *   { externalUserId: string }  — or snake_case alias external_user_id
 *
 * Response:
 *   { token: string, expiresAt: string (ISO), connectLinkUrl: string }
 *
 * Why: Pipedream Connect tokens must be minted server-side because the
 * Pipedream client secret must never be exposed to the browser.
 */
connectRouter.post("/v1/connect/tokens", async (req, res) => {
  logger.info("POST /v1/connect/tokens — creating Connect token", "connectRoutes");

  // Accept both camelCase and snake_case field names for flexibility.
  const externalUserId =
    typeof req.body?.externalUserId === "string"
      ? req.body.externalUserId
      : typeof req.body?.external_user_id === "string"
        ? req.body.external_user_id
        : null;

  if (!externalUserId?.trim()) {
    logger.warn("Missing externalUserId in request body", "connectRoutes");
    res.status(400).json({ error: "externalUserId (or external_user_id) is required" });
    return;
  }

  try {
    const pd = getPipedreamClient();
    logger.info(`Creating token for externalUserId="${externalUserId.trim()}"`, "connectRoutes");

    const created = await pd.tokens.create({ externalUserId: externalUserId.trim() });

    logger.info("Connect token created successfully", "connectRoutes");

    res.json({
      token: created.token,
      // Normalise to ISO string regardless of whether Pipedream returns a Date
      // or a string — the browser SDK and client code both expect a string.
      expiresAt:
        created.expiresAt instanceof Date
          ? created.expiresAt.toISOString()
          : created.expiresAt,
      connectLinkUrl: created.connectLinkUrl,
    });
  } catch (e) {
    logger.error("Failed to create Connect token", "connectRoutes", e);
    res.status(500).json({
      error: e instanceof Error ? e.message : "Failed to create Connect token",
    });
  }
});