/** Mirrors server `AssistantTurnResponse` (keep in sync with chat-api assistantNormalize). */

export type ChatPhase = "clarify" | "configure" | "summarize" | "finalize";

export type WidgetKind =
  | "none"
  | "app_picker"
  | "connect_account"
  | "field_config"
  | "workflow_summary"
  | "conditional_builder";

export type WidgetEnvelope = {
  kind: WidgetKind;
  title?: string;
  payload: Record<string, unknown>;
};

export type AssistantTurnResponse = {
  message: string;
  phase: ChatPhase;
  widget: WidgetEnvelope | null;
  workflowPatch: Record<string, unknown> | null;
  /** Present when phase=finalize and the draft passed server-side Zod validation. */
  finalizedJson?: Record<string, unknown>;
};
