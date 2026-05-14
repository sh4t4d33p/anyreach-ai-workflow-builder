/**
 * @file assistantNormalize.ts
 * @service chat-api
 * @description Types and parser for the structured JSON the Gemini model returns
 * on each chat turn.
 *
 * Gemini is instructed (via the response schema in assistantSchema.ts) to return
 * a flat JSON object with string fields for widget payload and workflow patch —
 * nested JSON is embedded as strings to avoid Gemini's structured-output
 * limitations with deeply-nested schemas.
 *
 * This module:
 *  1. Exports the AssistantTurnResponse type used throughout the service.
 *  2. Provides parseAssistantTurnFromModelJson() which validates and
 *     normalises the raw model output into a typed response object.
 *  3. Re-exports the Gemini Schema for use in getGenerativeModel().
 *
 * Why flat JSON with embedded string fields?
 *  Gemini's structured output (responseSchema) works reliably for flat objects.
 *  Deeply nested schemas can cause hallucinations or schema violations.
 *  Embedding payload and patch as JSON strings is a pragmatic workaround that
 *  keeps the response schema simple while preserving full expressiveness.
 */

import type { Schema } from "@google/generative-ai";
import { assistantTurnResponseSchema } from "./assistantSchema.js";
import { logger } from "./logger.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** The four phases of a chat-driven workflow authoring session. */
export type ChatPhase = "clarify" | "configure" | "summarize" | "finalize";

/**
 * All widget kinds the assistant can request the UI to render.
 * "none" means free-form chat only for this turn.
 */
export type WidgetKind =
  | "none"
  | "app_picker"
  | "connect_account"
  | "field_config"
  | "workflow_summary"
  | "conditional_builder";

/**
 * A widget request from the assistant, composed of a kind discriminant,
 * an optional display title, and a freeform payload object.
 */
export type WidgetEnvelope = {
  kind: WidgetKind;
  title?: string;
  payload: Record<string, unknown>;
};

/**
 * The fully-normalised response returned by the chat-api for each turn.
 * This is the shape sent back to the browser as the HTTP response body.
 */
export type AssistantTurnResponse = {
  /** User-visible reply text — the only natural-language field. */
  message: string;
  /** Which phase of the workflow authoring flow this turn belongs to. */
  phase: ChatPhase;
  /** Widget to render in the UI, or null for plain chat. */
  widget: WidgetEnvelope | null;
  /** Partial draft update to merge client-side, or null if draft unchanged. */
  workflowPatch: Record<string, unknown> | null;
  /**
   * Set server-side when phase=finalize AND the draft passes Zod validation.
   * Contains the clean, export-ready workflow JSON.
   */
  finalizedJson?: Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// Internal validation helpers
// ---------------------------------------------------------------------------

const PHASES: ChatPhase[] = ["clarify", "configure", "summarize", "finalize"];
const WIDGETS: WidgetKind[] = [
  "none",
  "app_picker",
  "connect_account",
  "field_config",
  "workflow_summary",
  "conditional_builder",
];

/** Type-guard for ChatPhase — rejects any string not in the known set. */
function isChatPhase(v: string): v is ChatPhase {
  return (PHASES as string[]).includes(v);
}

/** Type-guard for WidgetKind — rejects any string not in the known set. */
function isWidgetKind(v: string): v is WidgetKind {
  return (WIDGETS as string[]).includes(v);
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/**
 * Parses and normalises the raw JSON string returned by the Gemini model into
 * a typed AssistantTurnResponse.
 *
 * How it works:
 *  1. JSON.parse the raw string — throws on malformed JSON.
 *  2. Validate required fields (message, phase, widgetKind, widgetPayloadJson).
 *  3. Parse the embedded JSON strings (widgetPayloadJson, workflowPatchJson).
 *  4. Build the WidgetEnvelope (null when widgetKind is "none").
 *  5. Return the normalised turn object.
 *
 * Why embedded JSON strings?
 *  Gemini structured output works reliably for flat objects.  Deeply nested
 *  schemas cause hallucinations.  The model returns payload and patch as
 *  JSON-within-JSON strings which we parse here on the trusted server side.
 *
 * @param raw  The raw response text from Gemini (should be a JSON string).
 * @returns    A validated AssistantTurnResponse.
 * @throws     Error with a descriptive message for any validation failure.
 */
export function parseAssistantTurnFromModelJson(raw: string): AssistantTurnResponse {
  logger.info("Parsing model JSON response", "normalize", { rawLength: raw.length });

  // Step 1: Outer JSON parse.
  let data: unknown;
  try {
    data = JSON.parse(raw) as unknown;
  } catch {
    logger.error("Model returned invalid JSON", "normalize");
    throw new Error("Model returned invalid JSON");
  }

  if (!data || typeof data !== "object") {
    throw new Error("Model JSON must be an object");
  }

  const o = data as Record<string, unknown>;
  const { message, phase, widgetKind, widgetTitle, widgetPayloadJson, workflowPatchJson } = o;

  // Step 2: Required field validation.
  if (typeof message !== "string" || !message.trim()) {
    throw new Error('Model JSON missing string field "message"');
  }
  if (typeof phase !== "string" || !isChatPhase(phase)) {
    throw new Error(`Model JSON invalid "phase": got ${String(phase)}`);
  }
  if (typeof widgetKind !== "string" || !isWidgetKind(widgetKind)) {
    throw new Error(`Model JSON invalid "widgetKind": got ${String(widgetKind)}`);
  }
  if (typeof widgetPayloadJson !== "string") {
    throw new Error('Model JSON missing string "widgetPayloadJson"');
  }

  logger.info(`Model response: phase="${phase}" widgetKind="${widgetKind}"`, "normalize");

  // Step 3a: Parse the widget payload JSON string.
  // An empty object "{}" is the canonical "no payload" value.
  let payload: Record<string, unknown> = {};
  try {
    const p = JSON.parse(widgetPayloadJson) as unknown;
    if (p && typeof p === "object" && !Array.isArray(p)) {
      payload = p as Record<string, unknown>;
    } else if (widgetPayloadJson.trim() && widgetPayloadJson.trim() !== "null") {
      throw new Error("widgetPayloadJson must be a JSON object");
    }
  } catch (e) {
    if (e instanceof SyntaxError) {
      logger.error("widgetPayloadJson is not valid JSON", "normalize");
      throw new Error("widgetPayloadJson is not valid JSON");
    }
    throw e;
  }

  // Step 3b: Parse the workflow patch JSON string (optional — null = no change).
  let workflowPatch: Record<string, unknown> | null = null;
  if (workflowPatchJson != null && typeof workflowPatchJson === "string") {
    const t = workflowPatchJson.trim();
    if (t && t !== "null") {
      try {
        const patch = JSON.parse(t) as unknown;
        if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
          throw new Error("workflowPatchJson must be a JSON object");
        }
        workflowPatch = patch as Record<string, unknown>;
        logger.info("Workflow patch parsed successfully", "normalize", {
          patchKeys: Object.keys(workflowPatch),
        });
      } catch (e) {
        if (e instanceof SyntaxError) {
          logger.error("workflowPatchJson is not valid JSON", "normalize");
          throw new Error("workflowPatchJson is not valid JSON");
        }
        throw e;
      }
    }
  }

  // Step 4: Build the WidgetEnvelope.  "none" means no widget this turn.
  const widget: WidgetEnvelope | null =
    widgetKind === "none"
      ? null
      : {
          kind: widgetKind,
          title:
            typeof widgetTitle === "string" && widgetTitle.trim()
              ? widgetTitle.trim()
              : undefined,
          payload,
        };

  logger.info("Model JSON parsed and normalised successfully", "normalize");

  return {
    message: message.trim(),
    phase,
    widget,
    workflowPatch,
  };
}

/**
 * Returns the assistantTurnResponseSchema cast to Gemini's Schema type.
 *
 * The schema is defined in assistantSchema.ts with Zod-like but Gemini-native
 * types.  This cast is needed because TypeScript's strict inference of the
 * `as const` literal type in assistantSchema.ts is narrower than the Schema
 * interface that getGenerativeModel() expects.
 *
 * @returns The Gemini-compatible JSON schema for structured model output.
 */
export function assistantTurnSchema(): Schema {
  return assistantTurnResponseSchema as unknown as Schema;
}
