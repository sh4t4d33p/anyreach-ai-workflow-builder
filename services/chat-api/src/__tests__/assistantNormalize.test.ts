import { describe, it, expect } from "vitest";
import { parseAssistantTurnFromModelJson } from "../assistantNormalize.js";

function buildRaw(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    message: "How can I help?",
    phase: "clarify",
    widgetKind: "none",
    widgetTitle: "",
    widgetPayloadJson: "{}",
    workflowPatchJson: "null",
    ...overrides,
  });
}

describe("parseAssistantTurnFromModelJson", () => {
  it("parses a valid minimal response", () => {
    const result = parseAssistantTurnFromModelJson(buildRaw());
    expect(result.message).toBe("How can I help?");
    expect(result.phase).toBe("clarify");
    expect(result.widget).toBeNull();
    expect(result.workflowPatch).toBeNull();
  });

  it("trims whitespace from the message", () => {
    const result = parseAssistantTurnFromModelJson(buildRaw({ message: "  Hello  " }));
    expect(result.message).toBe("Hello");
  });

  it("returns null widget when widgetKind is 'none'", () => {
    const result = parseAssistantTurnFromModelJson(buildRaw({ widgetKind: "none" }));
    expect(result.widget).toBeNull();
  });

  it("builds a WidgetEnvelope when widgetKind is a known widget type", () => {
    const payload = JSON.stringify({ initialQuery: "slack" });
    const result = parseAssistantTurnFromModelJson(
      buildRaw({ widgetKind: "app_picker", widgetTitle: "Pick an app", widgetPayloadJson: payload }),
    );
    expect(result.widget).not.toBeNull();
    expect(result.widget?.kind).toBe("app_picker");
    expect(result.widget?.title).toBe("Pick an app");
    expect(result.widget?.payload).toEqual({ initialQuery: "slack" });
  });

  it("omits title from widget when widgetTitle is empty", () => {
    const result = parseAssistantTurnFromModelJson(
      buildRaw({ widgetKind: "connect_account", widgetTitle: "", widgetPayloadJson: '{"app":"slack"}' }),
    );
    expect(result.widget?.title).toBeUndefined();
  });

  it("parses workflowPatch from workflowPatchJson string", () => {
    const patch = JSON.stringify({ title: "New Workflow" });
    const result = parseAssistantTurnFromModelJson(buildRaw({ workflowPatchJson: patch }));
    expect(result.workflowPatch).toEqual({ title: "New Workflow" });
  });

  it("returns null workflowPatch when workflowPatchJson is the string 'null'", () => {
    const result = parseAssistantTurnFromModelJson(buildRaw({ workflowPatchJson: "null" }));
    expect(result.workflowPatch).toBeNull();
  });

  it("returns null workflowPatch when workflowPatchJson is empty string", () => {
    const result = parseAssistantTurnFromModelJson(buildRaw({ workflowPatchJson: "" }));
    expect(result.workflowPatch).toBeNull();
  });

  it("throws on invalid outer JSON", () => {
    expect(() => parseAssistantTurnFromModelJson("not json")).toThrow("invalid JSON");
  });

  it("throws when outer JSON is not an object", () => {
    expect(() => parseAssistantTurnFromModelJson('"just a string"')).toThrow(
      "must be an object",
    );
  });

  it("throws when message field is missing", () => {
    expect(() =>
      parseAssistantTurnFromModelJson(buildRaw({ message: "" })),
    ).toThrow(/message/i);
  });

  it("throws when phase is not a valid ChatPhase", () => {
    expect(() =>
      parseAssistantTurnFromModelJson(buildRaw({ phase: "unknown_phase" })),
    ).toThrow(/phase/i);
  });

  it("throws when widgetKind is not a valid WidgetKind", () => {
    expect(() =>
      parseAssistantTurnFromModelJson(buildRaw({ widgetKind: "magic_widget" })),
    ).toThrow(/widgetKind/i);
  });

  it("throws when widgetPayloadJson is not valid JSON", () => {
    expect(() =>
      parseAssistantTurnFromModelJson(buildRaw({ widgetPayloadJson: "{bad json" })),
    ).toThrow(/widgetPayloadJson/i);
  });

  it("throws when workflowPatchJson is not valid JSON", () => {
    expect(() =>
      parseAssistantTurnFromModelJson(buildRaw({ workflowPatchJson: "{bad patch" })),
    ).toThrow(/workflowPatchJson/i);
  });

  it("accepts all valid phase values", () => {
    for (const phase of ["clarify", "configure", "summarize", "finalize"]) {
      const result = parseAssistantTurnFromModelJson(buildRaw({ phase }));
      expect(result.phase).toBe(phase);
    }
  });

  it("accepts all valid widgetKind values", () => {
    const kinds = [
      "none",
      "app_picker",
      "connect_account",
      "field_config",
      "workflow_summary",
      "conditional_builder",
    ];
    for (const widgetKind of kinds) {
      const result = parseAssistantTurnFromModelJson(buildRaw({ widgetKind }));
      expect(result.widget?.kind ?? "none").toBe(widgetKind);
    }
  });
});
