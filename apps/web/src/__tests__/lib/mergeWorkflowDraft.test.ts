import { describe, it, expect } from "vitest";
import { mergeWorkflowDraft } from "../../lib/mergeWorkflowDraft";
import type { WorkflowDraft } from "../../types/session";

function baseDraft(): WorkflowDraft {
  return {
    schemaVersion: 1,
    title: "Original title",
    trigger: null,
    steps: [],
    conditions: [],
    policies: { retry: null, onFailure: null },
  };
}

describe("mergeWorkflowDraft", () => {
  it("returns original draft unchanged when patch is null", () => {
    const draft = baseDraft();
    const result = mergeWorkflowDraft(draft, null);
    expect(result).toEqual(draft);
  });

  it("does not mutate the original draft", () => {
    const draft = baseDraft();
    const frozen = Object.freeze(draft);
    expect(() => mergeWorkflowDraft(frozen, { title: "New" })).not.toThrow();
  });

  it("merges title when patch supplies a string", () => {
    const result = mergeWorkflowDraft(baseDraft(), { title: "Updated title" });
    expect(result.title).toBe("Updated title");
  });

  it("ignores title when patch supplies a non-string value", () => {
    const result = mergeWorkflowDraft(baseDraft(), { title: 42 });
    expect(result.title).toBe("Original title");
  });

  it("sets trigger when patch includes a trigger object", () => {
    const trigger = { componentKey: "google_sheets-new-spreadsheet-row", app: "google_sheets" };
    const result = mergeWorkflowDraft(baseDraft(), { trigger });
    expect(result.trigger).toEqual(trigger);
  });

  it("clears trigger when patch sets trigger to null", () => {
    const draft = { ...baseDraft(), trigger: { componentKey: "some-trigger" } };
    const result = mergeWorkflowDraft(draft, { trigger: null });
    expect(result.trigger).toBeNull();
  });

  it("ignores trigger when patch contains an array (invalid)", () => {
    const result = mergeWorkflowDraft(baseDraft(), { trigger: ["invalid"] });
    expect(result.trigger).toBeNull();
  });

  it("replaces steps array from patch", () => {
    const steps = [{ id: "step_1", componentKey: "slack-send-message" }];
    const result = mergeWorkflowDraft(baseDraft(), { steps });
    expect(result.steps).toEqual(steps);
  });

  it("filters non-object entries out of patch steps", () => {
    const steps = [
      { id: "step_1", componentKey: "slack-send-message" },
      "invalid-string",
      null,
      42,
    ];
    const result = mergeWorkflowDraft(baseDraft(), { steps });
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]).toEqual({ id: "step_1", componentKey: "slack-send-message" });
  });

  it("replaces conditions array from patch", () => {
    const conditions = [{ thenId: "step_1", elseId: "step_2" }];
    const result = mergeWorkflowDraft(baseDraft(), { conditions });
    expect(result.conditions).toEqual(conditions);
  });

  it("merges policies.retry without touching policies.onFailure", () => {
    const draft = {
      ...baseDraft(),
      policies: {
        retry: null,
        onFailure: { strategy: "stop" as const },
      },
    };
    const result = mergeWorkflowDraft(draft, {
      policies: { retry: { maxAttempts: 3, backoffSeconds: 2 } },
    });
    expect(result.policies.retry).toEqual({ maxAttempts: 3, backoffSeconds: 2 });
    expect(result.policies.onFailure).toEqual({ strategy: "stop" });
  });

  it("merges policies.onFailure without touching policies.retry", () => {
    const draft = {
      ...baseDraft(),
      policies: {
        retry: { maxAttempts: 2, backoffSeconds: 1 },
        onFailure: null,
      },
    };
    const result = mergeWorkflowDraft(draft, {
      policies: { onFailure: { strategy: "fallback", fallbackStepId: "fallback_step" } },
    });
    expect(result.policies.retry).toEqual({ maxAttempts: 2, backoffSeconds: 1 });
    expect(result.policies.onFailure).toEqual({
      strategy: "fallback",
      fallbackStepId: "fallback_step",
    });
  });

  it("clears policies.retry when patch sets it to null", () => {
    const draft = {
      ...baseDraft(),
      policies: { retry: { maxAttempts: 3 }, onFailure: null },
    };
    const result = mergeWorkflowDraft(draft, { policies: { retry: null } });
    expect(result.policies.retry).toBeNull();
  });

  it("ignores unknown patch keys", () => {
    const result = mergeWorkflowDraft(baseDraft(), { unknownField: "surprise", anotherOne: 99 });
    expect(result).toEqual(baseDraft());
  });
});
