import { describe, it, expect } from "vitest";
import { validateWorkflowDraft } from "../workflowValidator.js";

function validDraft() {
  return {
    schemaVersion: 1,
    title: "My Workflow",
    trigger: {
      componentKey: "google_sheets-new-spreadsheet-row",
      app: "google_sheets",
      accountId: "apn_abc123",
    },
    steps: [
      {
        id: "notify",
        componentKey: "slack-send-message",
        app: "slack",
        accountId: "apn_def456",
      },
    ],
    conditions: [],
    policies: { retry: null, onFailure: null },
  };
}

describe("validateWorkflowDraft", () => {
  it("returns ok:true for a fully valid draft", () => {
    expect(validateWorkflowDraft(validDraft())).toEqual({ ok: true });
  });

  it("returns ok:false when draft is not an object", () => {
    const result = validateWorkflowDraft("not an object");
    expect(result.ok).toBe(false);
  });

  it("returns ok:false when title is missing", () => {
    const draft = { ...validDraft(), title: "" };
    const result = validateWorkflowDraft(draft);
    expect(result.ok).toBe(false);
    expect((result as { ok: false; errors: string[] }).errors.join(" ")).toMatch(/title/i);
  });

  it("returns ok:false when schemaVersion is wrong", () => {
    const draft = { ...validDraft(), schemaVersion: 2 };
    const result = validateWorkflowDraft(draft);
    expect(result.ok).toBe(false);
  });

  it("returns ok:false when trigger is null (missing)", () => {
    const draft = { ...validDraft(), trigger: null };
    const result = validateWorkflowDraft(draft);
    expect(result.ok).toBe(false);
    expect((result as { ok: false; errors: string[] }).errors.join(" ")).toMatch(/trigger/i);
  });

  it("returns ok:false when trigger has app but no accountId", () => {
    const draft = {
      ...validDraft(),
      trigger: { componentKey: "google_sheets-new-spreadsheet-row", app: "google_sheets" },
    };
    const result = validateWorkflowDraft(draft);
    expect(result.ok).toBe(false);
    expect((result as { ok: false; errors: string[] }).errors.join(" ")).toMatch(/accountId/i);
  });

  it("returns ok:false when steps array is empty", () => {
    const draft = { ...validDraft(), steps: [] };
    const result = validateWorkflowDraft(draft);
    expect(result.ok).toBe(false);
    expect((result as { ok: false; errors: string[] }).errors.join(" ")).toMatch(/step/i);
  });

  it("returns ok:false when a step has app but no accountId", () => {
    const draft = {
      ...validDraft(),
      steps: [{ id: "notify", componentKey: "slack-send-message", app: "slack" }],
    };
    const result = validateWorkflowDraft(draft);
    expect(result.ok).toBe(false);
    expect((result as { ok: false; errors: string[] }).errors.join(" ")).toMatch(/accountId/i);
  });

  it("returns ok:false when a step is missing its id", () => {
    const draft = {
      ...validDraft(),
      steps: [{ componentKey: "slack-send-message", accountId: "apn_x" }],
    };
    const result = validateWorkflowDraft(draft);
    expect(result.ok).toBe(false);
  });

  it("returns ok:false when condition thenId references a non-existent step", () => {
    const draft = {
      ...validDraft(),
      conditions: [{ thenId: "ghost_step", elseId: "notify" }],
    };
    const result = validateWorkflowDraft(draft);
    expect(result.ok).toBe(false);
    expect((result as { ok: false; errors: string[] }).errors.join(" ")).toMatch(/thenId/i);
  });

  it("returns ok:false when condition elseId references a non-existent step", () => {
    const draft = {
      ...validDraft(),
      conditions: [{ thenId: "notify", elseId: "missing_step" }],
    };
    const result = validateWorkflowDraft(draft);
    expect(result.ok).toBe(false);
    expect((result as { ok: false; errors: string[] }).errors.join(" ")).toMatch(/elseId/i);
  });

  it("returns ok:false when onFailure fallbackStepId references a non-existent step", () => {
    const draft = {
      ...validDraft(),
      policies: {
        retry: null,
        onFailure: { strategy: "fallback", fallbackStepId: "no_such_step" },
      },
    };
    const result = validateWorkflowDraft(draft);
    expect(result.ok).toBe(false);
    expect((result as { ok: false; errors: string[] }).errors.join(" ")).toMatch(
      /fallbackStepId/i,
    );
  });

  it("returns ok:true when trigger has no app (no accountId required)", () => {
    const draft = {
      ...validDraft(),
      trigger: { componentKey: "google_sheets-new-spreadsheet-row" },
    };
    expect(validateWorkflowDraft(draft)).toEqual({ ok: true });
  });

  it("returns ok:true when valid conditions reference real step ids", () => {
    const draft = {
      ...validDraft(),
      conditions: [{ thenId: "notify", elseId: "notify" }],
    };
    expect(validateWorkflowDraft(draft)).toEqual({ ok: true });
  });

  it("accepts valid retry policy with maxAttempts >= 1", () => {
    const draft = {
      ...validDraft(),
      policies: { retry: { maxAttempts: 3, backoffSeconds: 2 }, onFailure: null },
    };
    expect(validateWorkflowDraft(draft)).toEqual({ ok: true });
  });

  it("returns ok:false when retry maxAttempts is 0", () => {
    const draft = {
      ...validDraft(),
      policies: { retry: { maxAttempts: 0 }, onFailure: null },
    };
    const result = validateWorkflowDraft(draft);
    expect(result.ok).toBe(false);
  });
});
