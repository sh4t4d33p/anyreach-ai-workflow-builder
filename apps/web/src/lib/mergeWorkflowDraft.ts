/**
 * @file lib/mergeWorkflowDraft.ts
 * @app web
 * @description Shallow / targeted merge of server-provided workflowPatch into
 * the client's in-memory WorkflowDraft.
 *
 * Why a custom merge instead of Object.assign / spread?
 *  - The patch may contain null to explicitly clear a field (e.g. trigger: null).
 *    A naive spread would lose this intent: { ...draft, ...patch } with
 *    patch.trigger = null correctly sets trigger to null, but we also need to
 *    handle nested objects like policies carefully.
 *  - Each top-level key is handled individually so that missing keys in the
 *    patch are truly "no-op" (they don't overwrite existing draft values).
 *  - The policies sub-object is shallowly merged so that setting only
 *    policies.retry does not accidentally clear policies.onFailure.
 *
 * This function is intentionally side-effect free — it returns a new object
 * and never mutates the input draft or patch.
 */

import type { WorkflowDraft } from "../types/session";

/**
 * Merges a partial workflowPatch into the current draft, returning a new
 * WorkflowDraft without mutating either input.
 *
 * Handled patch keys:
 *  - title      → replaces if present and is a string.
 *  - trigger    → replaces (allows null to clear the trigger).
 *  - steps      → replaces with a filtered array of plain objects.
 *  - conditions → replaces with a filtered array of plain objects.
 *  - policies   → shallowly merges retry and onFailure independently.
 *
 * Keys not in the above list are silently ignored — the server may send
 * forward-compatible fields that older client code should not break on.
 *
 * @param current  The existing in-memory WorkflowDraft (not mutated).
 * @param patch    The partial update from the server (null = no-op).
 * @returns        A new WorkflowDraft with all patch changes applied.
 */
export function mergeWorkflowDraft(
  current: WorkflowDraft,
  patch: Record<string, unknown> | null,
): WorkflowDraft {
  // No patch this turn — return the existing draft unchanged.
  if (!patch) return current;

  console.log("[mergeWorkflowDraft] Applying patch", { patchKeys: Object.keys(patch) });

  // Start with a shallow copy.  policies is also spread so mutations to
  // the returned object do not reach back into the original draft.
  const next: WorkflowDraft = {
    ...current,
    policies: { ...current.policies },
  };

  // title: only replace when the patch supplies a non-null string.
  if (typeof patch.title === "string") {
    next.title = patch.title;
  }

  // trigger: "trigger" key present in patch (even as null) → update.
  // This allows the model to explicitly clear the trigger with { trigger: null }.
  if ("trigger" in patch) {
    next.trigger =
      patch.trigger === null
        ? null
        : typeof patch.trigger === "object" &&
            patch.trigger !== null &&
            !Array.isArray(patch.trigger)
          ? (patch.trigger as Record<string, unknown>)
          : null;
  }

  // steps: replace the full array when provided.
  // Filter to plain objects only — guards against the model accidentally
  // returning primitives or arrays inside the steps array.
  if (Array.isArray(patch.steps)) {
    next.steps = patch.steps.filter(
      (s): s is Record<string, unknown> =>
        typeof s === "object" && s !== null && !Array.isArray(s),
    ) as Record<string, unknown>[];
  }

  // policies: merge retry and onFailure independently so patching one
  // does not silently clear the other.
  if (patch.policies && typeof patch.policies === "object" && !Array.isArray(patch.policies)) {
    const p = patch.policies as Record<string, unknown>;

    if ("retry" in p) {
      next.policies.retry =
        p.retry === null
          ? null
          : typeof p.retry === "object" && p.retry !== null && !Array.isArray(p.retry)
            ? (p.retry as { maxAttempts: number; backoffSeconds?: number })
            : next.policies.retry;
    }

    if ("onFailure" in p) {
      next.policies.onFailure =
        p.onFailure === null
          ? null
          : typeof p.onFailure === "object" &&
              p.onFailure !== null &&
              !Array.isArray(p.onFailure)
            ? (p.onFailure as { strategy: "stop" | "fallback"; fallbackStepId?: string })
            : next.policies.onFailure;
    }
  }

  // conditions: replace the full array when provided.
  if (Array.isArray(patch.conditions)) {
    next.conditions = patch.conditions.filter(
      (c): c is Record<string, unknown> =>
        typeof c === "object" && c !== null && !Array.isArray(c),
    ) as Record<string, unknown>[];
  }

  console.log("[mergeWorkflowDraft] Patch applied successfully");
  return next;
}
