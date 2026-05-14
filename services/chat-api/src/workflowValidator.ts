/**
 * @file workflowValidator.ts
 * @service chat-api
 * @description Server-side Zod validation for workflow draft objects.
 *
 * This module validates the workflow draft that is stored on the client and
 * sent to the chat-api on every turn.  Validation runs in two layers:
 *
 *  Layer 1 — Zod schema parse:
 *    Checks structural correctness: required fields, correct types, enum
 *    values, numeric constraints.  Uses z.looseObject() (Zod v4) so extra
 *    keys added by the client or future phases do not cause spurious errors.
 *
 *  Layer 2 — Semantic / graph checks:
 *    Validates constraints that Zod cannot express:
 *      - Trigger and steps with an `app` field must also have `accountId`
 *        (OAuth not connected → block finalize, prompt user to connect).
 *      - Condition thenId/elseId and onFailure.fallbackStepId must reference
 *        real step ids in the steps array (graph consistency).
 *
 * Validation errors are injected into the Gemini system prompt each turn so
 * the model can proactively guide the user to resolve them before finalising.
 * The model is also blocked from setting phase="finalize" while errors exist.
 */

import { z } from "zod";
import { logger } from "./logger.js";

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

/**
 * Schema for the workflow trigger.
 * looseObject allows arbitrary extra fields (e.g. props, accountId set by UI).
 */
const TriggerSchema = z.looseObject({
  componentKey: z.string().min(1, "trigger.componentKey is required"),
  app: z.string().optional(),
  accountId: z.string().optional(),
});

/**
 * Schema for a single action step.
 * Each step must have a unique string id and a componentKey.
 */
const StepSchema = z.looseObject({
  id: z.string().min(1, "step.id is required"),
  componentKey: z.string().min(1, "step.componentKey is required"),
  app: z.string().optional(),
  accountId: z.string().optional(),
});

/**
 * Schema for a conditional branch.
 * thenId and elseId are validated against the steps array in the semantic layer.
 */
const ConditionSchema = z.looseObject({
  thenId: z.string().optional(),
  elseId: z.string().optional(),
});

/**
 * Schema for workflow-level error-handling policies.
 * Both retry and onFailure are nullable so the UI can clear them.
 */
const PoliciesSchema = z
  .object({
    retry: z
      .union([
        z.object({
          maxAttempts: z.number().int().min(1, "retry.maxAttempts must be >= 1"),
          backoffSeconds: z.number().optional(),
        }),
        z.null(),
      ])
      .optional(),
    onFailure: z
      .union([
        z.object({
          strategy: z.enum(["stop", "fallback"]),
          fallbackStepId: z.string().optional(),
        }),
        z.null(),
      ])
      .optional(),
  })
  .optional();

/**
 * Top-level workflow draft schema.
 * schemaVersion: 1 is a literal to future-proof against format migrations.
 */
const WorkflowDraftSchema = z.object({
  schemaVersion: z.literal(1),
  title: z.string().min(1, "Workflow title is required"),
  trigger: TriggerSchema.nullable(),
  steps: z.array(StepSchema),
  conditions: z.array(ConditionSchema).optional(),
  policies: PoliciesSchema,
});

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Discriminated union result from validateWorkflowDraft(). */
export type ValidationResult =
  | { ok: true }
  | { ok: false; errors: string[] };

// ---------------------------------------------------------------------------
// Validator
// ---------------------------------------------------------------------------

/**
 * Validates a raw (unknown-typed) workflow draft against the Zod schema and
 * semantic graph rules.
 *
 * How it works:
 *  1. Run safeParse — collect Zod structural errors.
 *  2. If Zod fails, return immediately (semantic checks require a valid shape).
 *  3. Run semantic checks on the parsed data:
 *     a. Trigger must be non-null with a componentKey.
 *     b. Trigger app without accountId → missing OAuth.
 *     c. Steps array must be non-empty.
 *     d. Each step app without accountId → missing OAuth.
 *     e. Condition branch ids must reference real step ids.
 *     f. onFailure.fallbackStepId must reference a real step id.
 *
 * @param draft  The raw draft value from the request body.
 * @returns      { ok: true } or { ok: false, errors: string[] }.
 */
export function validateWorkflowDraft(draft: unknown): ValidationResult {
  logger.info("Validating workflow draft", "validator");

  // --- Layer 1: Zod structural parse ---
  const result = WorkflowDraftSchema.safeParse(draft);

  if (!result.success) {
    // Map Zod issue objects to readable strings.
    // path.join(".") turns [steps, 0, id] into "steps.0.id: <message>".
    const errors = result.error.issues.map((issue) => {
      const path = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
      return `${path}${issue.message}`;
    });

    logger.warn(`Zod validation failed with ${errors.length} issue(s)`, "validator", errors);
    return { ok: false, errors };
  }

  // --- Layer 2: Semantic / graph checks ---
  const errors: string[] = [];
  const data = result.data;

  // 2a. Trigger presence
  if (!data.trigger) {
    errors.push("Trigger is not configured — define what starts this workflow");
  } else if (data.trigger.app && !data.trigger.accountId) {
    // 2b. Trigger OAuth: app is named but no account has been connected yet.
    errors.push(
      `Trigger app "${data.trigger.app}" is not connected — accountId is missing (connect the app first)`,
    );
  }

  // 2c. Steps non-empty
  if (data.steps.length === 0) {
    errors.push("Workflow must have at least one action step");
  }

  // Build a set of known step ids for O(1) reference checks below.
  const stepIds = new Set(data.steps.map((s) => s.id));

  // 2d. Step OAuth: each step that names an app must have accountId.
  for (const step of data.steps) {
    if (step.app && !step.accountId) {
      errors.push(
        `Step "${step.id}" app "${step.app}" is not connected — accountId is missing (connect the app first)`,
      );
    }
  }

  // 2e. Condition branch ids must reference real steps.
  for (const cond of data.conditions ?? []) {
    if (cond.thenId && !stepIds.has(cond.thenId as string)) {
      errors.push(`Condition thenId "${cond.thenId}" does not reference a known step id`);
    }
    if (cond.elseId && !stepIds.has(cond.elseId as string)) {
      errors.push(`Condition elseId "${cond.elseId}" does not reference a known step id`);
    }
  }

  // 2f. onFailure fallback step must exist in the steps array.
  const onFailure = data.policies?.onFailure;
  if (onFailure && onFailure.fallbackStepId && !stepIds.has(onFailure.fallbackStepId)) {
    errors.push(
      `policies.onFailure.fallbackStepId "${onFailure.fallbackStepId}" does not reference a known step id`,
    );
  }

  if (errors.length > 0) {
    logger.warn(`Semantic validation found ${errors.length} issue(s)`, "validator", errors);
    return { ok: false, errors };
  }

  logger.info("Workflow draft passed all validation checks", "validator");
  return { ok: true };
}