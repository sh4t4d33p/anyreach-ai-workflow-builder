import type { AssistantTurnResponse } from "./assistantTurn";

export type ChatRole = "user" | "assistant";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: number;
  /** Present on assistant bubbles: full structured turn from Phase 4+ API. */
  assistantTurn?: AssistantTurnResponse;
}

/** In-memory workflow draft (structure grows in later phases). */
export interface WorkflowDraft {
  schemaVersion: 1;
  title: string;
  trigger: Record<string, unknown> | null;
  steps: Record<string, unknown>[];
  conditions?: Record<string, unknown>[];
  /** Placeholder for bonus: retry / onFailure (Phase 8). */
  policies: {
    retry: { maxAttempts: number; backoffSeconds?: number } | null;
    onFailure: { strategy: "stop" | "fallback"; fallbackStepId?: string } | null;
  };
}

export function emptyWorkflowDraft(): WorkflowDraft {
  return {
    schemaVersion: 1,
    title: "",
    trigger: null,
    steps: [],
    conditions: [],
    policies: { retry: null, onFailure: null },
  };
}
