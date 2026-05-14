/**
 * @file routes/appRoutes.ts
 * @service pipedream-api
 * @description Express router for Pipedream app and component catalog endpoints.
 *
 * These routes power the workflow builder's discovery layer — the app picker
 * widget searches apps, and the field config widget uses action/trigger catalog
 * data to determine which components are available for each step.
 *
 * Routes:
 *   GET /v1/apps            — Search the Pipedream app registry.
 *   GET /v1/actions         — List actions for a given app.
 *   GET /v1/triggers        — List triggers for a given app.
 */

import { Router } from "express";
import { getPipedreamClient } from "../pipedream.js";
import { parseLimit } from "../utils/parseLimit.js";
import { logger } from "../logger.js";
import {
  DEFAULT_APP_LIST_LIMIT,
  MAX_APP_LIST_LIMIT,
  DEFAULT_COMPONENT_LIST_LIMIT,
  MAX_COMPONENT_LIST_LIMIT,
} from "../constants.js";

export const appRouter = Router();

/**
 * GET /v1/apps
 *
 * Searches the Pipedream public app registry.  Used by the AppPickerWidget to
 * let users browse and select integration apps.
 *
 * Query params:
 *   q?     — Free-text search term (e.g. "slack", "sheets").
 *   limit? — Max results to return (default 25, max 100).
 *
 * Response: { data: AppRecord[], hasNextPage: boolean }
 * Each AppRecord: { id, nameSlug, name, imgSrc, authType }
 */
appRouter.get("/v1/apps", async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q : undefined;
  const limit = parseLimit(req.query.limit, DEFAULT_APP_LIST_LIMIT, MAX_APP_LIST_LIMIT);

  logger.info(`GET /v1/apps q="${q ?? ""}" limit=${limit}`, "appRoutes");

  try {
    const pd = getPipedreamClient();
    const page = await pd.apps.list({ q, limit });

    // Project only the fields the UI needs — avoids leaking internal Pipedream
    // metadata and keeps the response payload small.
    const data = page.data.map((a) => ({
      id: a.id,
      nameSlug: a.nameSlug,
      name: a.name,
      imgSrc: a.imgSrc,
      authType: a.authType,
    }));

    logger.info(`GET /v1/apps returned ${data.length} result(s)`, "appRoutes");
    res.json({ data, hasNextPage: page.hasNextPage() });
  } catch (e) {
    logger.error("Failed to list apps", "appRoutes", e);
    res.status(500).json({
      error: e instanceof Error ? e.message : "Failed to list apps",
    });
  }
});

/**
 * GET /v1/actions
 *
 * Lists actions from the Pipedream public component registry, optionally
 * filtered by app slug and search query.  Used during field_config resolution
 * to find the correct action component key for a given step.
 *
 * Query params:
 *   app?   — App slug to filter by (e.g. "slack").
 *   q?     — Free-text search term.
 *   limit? — Max results (default 25, max 100).
 *
 * Response: { data: ComponentRecord[], hasNextPage: boolean }
 * Each ComponentRecord: { key, name, version, description }
 */
appRouter.get("/v1/actions", async (req, res) => {
  const appSlug = typeof req.query.app === "string" ? req.query.app : undefined;
  const q = typeof req.query.q === "string" ? req.query.q : undefined;
  const limit = parseLimit(req.query.limit, DEFAULT_COMPONENT_LIST_LIMIT, MAX_COMPONENT_LIST_LIMIT);

  logger.info(`GET /v1/actions app="${appSlug ?? ""}" q="${q ?? ""}" limit=${limit}`, "appRoutes");

  try {
    const pd = getPipedreamClient();
    const page = await pd.actions.list({ app: appSlug, q, limit, registry: "public" });

    const data = page.data.map((c) => ({
      key: c.key,
      name: c.name,
      version: c.version,
      description: c.description,
    }));

    logger.info(`GET /v1/actions returned ${data.length} result(s)`, "appRoutes");
    res.json({ data, hasNextPage: page.hasNextPage() });
  } catch (e) {
    logger.error("Failed to list actions", "appRoutes", e);
    res.status(500).json({
      error: e instanceof Error ? e.message : "Failed to list actions",
    });
  }
});

/**
 * GET /v1/triggers
 *
 * Lists triggers from the Pipedream public component registry.  Used during
 * field_config resolution to find the correct trigger component key for the
 * workflow trigger step.
 *
 * Query params:
 *   app?   — App slug to filter by (e.g. "google_sheets").
 *   q?     — Free-text search term.
 *   limit? — Max results (default 25, max 100).
 *
 * Response: { data: ComponentRecord[], hasNextPage: boolean }
 */
appRouter.get("/v1/triggers", async (req, res) => {
  const appSlug = typeof req.query.app === "string" ? req.query.app : undefined;
  const q = typeof req.query.q === "string" ? req.query.q : undefined;
  const limit = parseLimit(req.query.limit, DEFAULT_COMPONENT_LIST_LIMIT, MAX_COMPONENT_LIST_LIMIT);

  logger.info(`GET /v1/triggers app="${appSlug ?? ""}" q="${q ?? ""}" limit=${limit}`, "appRoutes");

  try {
    const pd = getPipedreamClient();
    const page = await pd.triggers.list({ app: appSlug, q, limit, registry: "public" });

    const data = page.data.map((c) => ({
      key: c.key,
      name: c.name,
      version: c.version,
      description: c.description,
    }));

    logger.info(`GET /v1/triggers returned ${data.length} result(s)`, "appRoutes");
    res.json({ data, hasNextPage: page.hasNextPage() });
  } catch (e) {
    logger.error("Failed to list triggers", "appRoutes", e);
    res.status(500).json({
      error: e instanceof Error ? e.message : "Failed to list triggers",
    });
  }
});