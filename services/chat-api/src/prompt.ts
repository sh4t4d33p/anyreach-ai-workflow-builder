/**
 * @file prompt.ts  (prompt builder)
 * @service chat-api
 * @description Assembles the per-turn Gemini system instruction from static
 * base copy and dynamic per-turn sections.
 *
 * Separation of responsibilities:
 *  - prompts/systemInstruction.ts  → static instruction text (no logic).
 *  - This file                     → runtime assembly: injects the current
 *    workflow-draft JSON and any Zod validation errors into the instruction.
 *
 * Why keep assembly logic separate from the prompt text?
 *  - Product/AI iterations on the instruction copy produce clean text diffs,
 *    not code diffs mixed with string literals.
 *  - The assembly logic here (truncation, error-block formatting) can be
 *    tested independently of the instruction content.
 */

import { SYSTEM_INSTRUCTION_BASE } from "./prompts/systemInstruction.js";
import { MAX_DRAFT_JSON_LENGTH } from "./constants.js";
import { logger } from "./logger.js";

/**
 * Builds the complete Gemini system instruction for a single chat turn.
 *
 * Assembly steps:
 *  1. Serialise workflowDraft to pretty-printed JSON.
 *  2. Truncate at MAX_DRAFT_JSON_LENGTH with a trailing notice when the draft
 *     is too large (prevents context-window overflow).
 *  3. Append the serialised draft after the static base.
 *  4. Optionally append a "## VALIDATION ERRORS" block when the Zod validator
 *     found issues — this tells the model to fix them before finalising.
 *
 * @param workflowDraft    The current in-memory draft (any shape accepted).
 * @param validationErrors Optional list of Zod/graph error strings.  When
 *                         provided, the model is instructed not to emit
 *                         phase="finalize" until all are resolved.
 * @returns The fully-assembled system instruction string.
 */
export function buildSystemInstruction(
  workflowDraft: unknown,
  validationErrors?: string[],
): string {
  logger.info("Building system instruction", "promptBuilder", {
    hasDraft: workflowDraft != null,
    validationErrorCount: validationErrors?.length ?? 0,
  });

  // Serialise the draft to JSON.  Pretty-printing (indent=2) improves model
  // comprehension of nested structures (trigger, steps, policies).
  const draftJson = JSON.stringify(workflowDraft ?? {}, null, 2);

  // Truncate very large drafts to avoid exceeding the Gemini context window.
  // A trailing "…(truncated)" notice is added so the model knows the JSON
  // was cut and does not try to act on partial data as if it were complete.
  const clipped =
    draftJson.length > MAX_DRAFT_JSON_LENGTH
      ? `${draftJson.slice(0, MAX_DRAFT_JSON_LENGTH)}\n…(truncated)`
      : draftJson;

  if (draftJson.length > MAX_DRAFT_JSON_LENGTH) {
    logger.warn(
      `Draft JSON truncated: ${draftJson.length} → ${MAX_DRAFT_JSON_LENGTH} chars`,
      "promptBuilder",
    );
  }

  // Build the validation-errors block.  Errors are numbered and labelled
  // prominently so the model treats resolution as a hard prerequisite before
  // allowing the finalize phase.
  const errorsBlock =
    validationErrors && validationErrors.length > 0
      ? `\n\n## VALIDATION ERRORS (must be resolved before the workflow can be finalized)\n` +
        `The current draft has ${validationErrors.length} issue(s). ` +
        `Do NOT set phase to "finalize" until all are resolved. ` +
        `For each error, guide the user to fix it — e.g. show connect_account for missing accountId, ` +
        `or ask a clarifying question for missing config.\n` +
        validationErrors.map((e, i) => `${i + 1}. ${e}`).join("\n")
      : "";

  const instruction = `${SYSTEM_INSTRUCTION_BASE}\n\nCurrent workflow draft:\n${clipped}${errorsBlock}`;

  logger.info(
    `System instruction assembled: ${instruction.length} chars`,
    "promptBuilder",
  );

  return instruction;
}