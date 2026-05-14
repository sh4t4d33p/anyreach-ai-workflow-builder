/**
 * @file routes/componentRoutes.ts
 * @service pipedream-api
 * @description Express router for Pipedream component detail and resolution endpoints.
 *
 * Components are the building blocks of Pipedream workflows — each action and
 * trigger has a unique key (e.g. "slack-send-message") and a set of configurable
 * props.  These routes support:
 *   - Direct retrieval of a component's full definition (for the field_config widget).
 *   - Fuzzy resolution when the LLM guesses an incorrect key.
 *   - Remote-option fetching for dependent dropdown fields (e.g. channel list).
 *
 * Routes:
 *   GET  /v1/actions/:componentKey           — Retrieve full action definition.
 *   GET  /v1/triggers/:componentKey          — Retrieve full trigger definition.
 *   GET  /v1/components/resolve              — Fuzzy-resolve an LLM-guessed key.
 *   POST /v1/components/configure-prop       — Fetch remote options for a prop.
 */

import { Router } from "express";
import { getPipedreamClient } from "../pipedream.js";
import { resolveComponent } from "../resolveComponent.js";
import { logger } from "../logger.js";

export const componentRouter = Router();

// ---------------------------------------------------------------------------
// Direct component retrieval
// ---------------------------------------------------------------------------

/**
 * GET /v1/actions/:componentKey
 *
 * Returns the full Pipedream action definition (including configurableProps)
 * for the given component key.  Used by the FieldConfigWidget to build the
 * dynamic prop form for action steps.
 *
 * Path param: componentKey — e.g. "slack-send-message"
 * Response: Raw Pipedream action retrieve response (includes data.configurableProps).
 */
componentRouter.get("/v1/actions/:componentKey", async (req, res) => {
  const key = req.params.componentKey;
  logger.info(`GET /v1/actions/${key}`, "componentRoutes");

  try {
    const pd = getPipedreamClient();
    const body = await pd.actions.retrieve(key, {});

    logger.info(`Action "${key}" retrieved successfully`, "componentRoutes");
    res.json(body);
  } catch (e) {
    logger.error(`Failed to retrieve action "${key}"`, "componentRoutes", e);
    res.status(500).json({
      error: e instanceof Error ? e.message : "Failed to retrieve action",
    });
  }
});

/**
 * GET /v1/triggers/:componentKey
 *
 * Returns the full Pipedream trigger definition (including configurableProps)
 * for the given component key.  Used by the FieldConfigWidget to build the
 * dynamic prop form for workflow trigger steps.
 *
 * Path param: componentKey — e.g. "google_sheets-new-spreadsheet-row"
 * Response: Raw Pipedream trigger retrieve response.
 */
componentRouter.get("/v1/triggers/:componentKey", async (req, res) => {
  const key = req.params.componentKey;
  logger.info(`GET /v1/triggers/${key}`, "componentRoutes");

  try {
    const pd = getPipedreamClient();
    const body = await pd.triggers.retrieve(key, {});

    logger.info(`Trigger "${key}" retrieved successfully`, "componentRoutes");
    res.json(body);
  } catch (e) {
    logger.error(`Failed to retrieve trigger "${key}"`, "componentRoutes", e);
    res.status(500).json({
      error: e instanceof Error ? e.message : "Failed to retrieve trigger",
    });
  }
});

// ---------------------------------------------------------------------------
// Fuzzy component resolution
// ---------------------------------------------------------------------------

/**
 * GET /v1/components/resolve
 *
 * Maps a possibly-incorrect LLM-generated component key to a real key that
 * the Pipedream SDK can retrieve.  Falls back to catalog fuzzy search when
 * direct retrieve returns 404.
 *
 * Why this exists: The LLM hallucinates component keys (e.g. "slack-message"
 * instead of "slack-send-message").  Rather than failing hard, the FieldConfig
 * widget calls this endpoint to find the closest real match.
 *
 * Query params:
 *   key    (required) — The raw component key from the LLM or draft.
 *   app?             — App slug hint to scope catalog search (improves accuracy).
 *   kind?            — "trigger" | "action" | "auto" (default "auto").
 *
 * Response: { matchedKey: string, kind: string, data: object }
 * 404 when no match found.
 */
componentRouter.get("/v1/components/resolve", async (req, res) => {
  const key = typeof req.query.key === "string" ? req.query.key.trim() : "";

  if (!key) {
    logger.warn("GET /v1/components/resolve called without key param", "componentRoutes");
    res.status(400).json({ error: "key query parameter is required" });
    return;
  }

  const app = typeof req.query.app === "string" ? req.query.app.trim() : undefined;
  const rawKind = typeof req.query.kind === "string" ? req.query.kind.toLowerCase() : "auto";
  const kind =
    rawKind === "trigger" || rawKind === "action" || rawKind === "auto" ? rawKind : "auto";

  logger.info(`GET /v1/components/resolve key="${key}" app="${app ?? ""}" kind="${kind}"`, "componentRoutes");

  try {
    const pd = getPipedreamClient();
    const resolved = await resolveComponent(pd, { key, app, kind });

    if (!resolved) {
      logger.warn(`Could not resolve component for key="${key}"`, "componentRoutes");
      res.status(404).json({
        error: "Could not resolve a retrievable component for this key",
        key,
        app: app ?? null,
      });
      return;
    }

    logger.info(
      `Resolved "${key}" → "${resolved.matchedKey}" (${resolved.kind})`,
      "componentRoutes",
    );

    res.json({
      matchedKey: resolved.matchedKey,
      kind: resolved.kind,
      data: resolved.data,
    });
  } catch (e) {
    logger.error(`Failed to resolve component key="${key}"`, "componentRoutes", e);
    res.status(500).json({
      error: e instanceof Error ? e.message : "Failed to resolve component",
    });
  }
});

// ---------------------------------------------------------------------------
// Remote prop options (configure-prop)
// ---------------------------------------------------------------------------

/**
 * Body shape for POST /v1/components/configure-prop.
 * All fields are validated manually because this is a proxy endpoint that
 * forwards to the Pipedream SDK — Zod would be over-engineering here.
 */
type ConfigurePropBody = {
  kind?: unknown;
  externalUserId?: unknown;
  external_user_id?: unknown;
  id?: unknown;
  propName?: unknown;
  configuredProps?: unknown;
  query?: unknown;
  page?: unknown;
  blocking?: unknown;
  version?: unknown;
  prevContext?: unknown;
  dynamicPropsId?: unknown;
};

/**
 * POST /v1/components/configure-prop
 *
 * Proxies a Pipedream "configureProp" call to fetch remote dropdown options
 * for a specific prop on a component (e.g. the channel list for slack-send-message).
 *
 * Why a proxy? The Pipedream SDK call requires the server-side client secret
 * and must also carry the user's auth context (externalUserId + configuredProps
 * with the authProvisionId) — it cannot be made directly from the browser.
 *
 * Request body (ConfigurePropBody):
 *   kind            — "action" | "trigger"
 *   externalUserId  — Pipedream user id (apn_...) or external_user_id alias
 *   id              — Component key (e.g. "slack-send-message")
 *   propName        — The prop whose options to fetch (e.g. "channel")
 *   configuredProps — Current prop values including app auth ({ slack: { authProvisionId } })
 *   query?          — Search filter string
 *   blocking?       — Whether to wait for async options (Pipedream flag)
 *
 * Response: Raw Pipedream configureProp response (options or stringOptions array).
 */
componentRouter.post("/v1/components/configure-prop", async (req, res) => {
  const body = req.body as ConfigurePropBody;

  const kind = body.kind === "action" ? "action" : "trigger";

  // Accept both camelCase and snake_case external user id formats.
  const externalUserId =
    typeof body.externalUserId === "string"
      ? body.externalUserId.trim()
      : typeof body.external_user_id === "string"
        ? body.external_user_id.trim()
        : "";

  const id = typeof body.id === "string" ? body.id.trim() : "";
  const propName = typeof body.propName === "string" ? body.propName.trim() : "";

  logger.info(
    `POST /v1/components/configure-prop kind="${kind}" id="${id}" propName="${propName}"`,
    "componentRoutes",
  );

  if (!externalUserId || !id || !propName) {
    logger.warn("configure-prop called with missing required fields", "componentRoutes", {
      externalUserId: Boolean(externalUserId),
      id: Boolean(id),
      propName: Boolean(propName),
    });
    res.status(400).json({
      error: "externalUserId, id (component key), and propName are required",
    });
    return;
  }

  // configuredProps must be a plain object (not an array) — it carries the
  // app auth provision id and any already-set upstream prop values.
  const configuredProps =
    body.configuredProps &&
    typeof body.configuredProps === "object" &&
    !Array.isArray(body.configuredProps)
      ? (body.configuredProps as Record<string, unknown>)
      : undefined;

  const opts = {
    id,
    externalUserId,
    propName,
    configuredProps,
    query: typeof body.query === "string" ? body.query : undefined,
    page: typeof body.page === "number" ? body.page : undefined,
    blocking: typeof body.blocking === "boolean" ? body.blocking : undefined,
    version: typeof body.version === "string" ? body.version : undefined,
    prevContext:
      body.prevContext &&
      typeof body.prevContext === "object" &&
      !Array.isArray(body.prevContext)
        ? (body.prevContext as Record<string, unknown>)
        : undefined,
    dynamicPropsId:
      typeof body.dynamicPropsId === "string" ? body.dynamicPropsId : undefined,
  };

  try {
    const pd = getPipedreamClient();

    // Route to the correct SDK method based on component kind.
    const raw =
      kind === "action"
        ? await pd.actions.configureProp(opts, {})
        : await pd.triggers.configureProp(opts, {});

    // The SDK wraps the result in a data envelope on some SDK versions;
    // unwrap it so the client always receives the options array directly.
    const payload =
      raw && typeof raw === "object" && "data" in raw
        ? (raw as { data: unknown }).data
        : raw;

    logger.info(`configure-prop for "${propName}" on "${id}" succeeded`, "componentRoutes");
    res.json((payload ?? {}) as Record<string, unknown>);
  } catch (e) {
    logger.error(
      `configure-prop failed for propName="${propName}" on "${id}"`,
      "componentRoutes",
      e,
    );
    res.status(500).json({
      error: e instanceof Error ? e.message : "configureProp failed",
    });
  }
});
