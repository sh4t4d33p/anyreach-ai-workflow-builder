/**
 * @file lib/chatApi.ts
 * @app web
 * @description Network layer for the chat-api service.
 *
 * Encapsulates all fetch calls to /v1/chat so that ChatPanel (and any future
 * consumer) only deal with typed inputs and outputs — no raw fetch, no HTTP
 * status parsing, no JSON casting scattered across components.
 *
 * Separation of concerns:
 *  - This file owns: HTTP transport, error extraction, response typing.
 *  - ChatPanel owns: React state, message list management, UI feedback.
 */

import type { AssistantTurnResponse } from "../types/assistantTurn";

/**
 * A single chat message as expected by the chat-api /v1/chat endpoint.
 */
export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

/**
 * Full request body for POST /v1/chat.
 */
export type ChatTurnRequest = {
  /** Conversation history including the new user message at the end. */
  messages: ChatMessage[];
  /** Current in-memory workflow draft sent for context and validation. */
  workflowDraft: unknown;
};

/**
 * Sends a single chat turn to the chat-api service and returns the
 * structured assistant response.
 *
 * How it works:
 *  1. POST to `<chatApiBase>/v1/chat` with the full message history and draft.
 *  2. Parse the JSON response body.
 *  3. Throw a descriptive Error for any non-2xx status (using the body's
 *     `error` field when available so the UI shows a meaningful message).
 *  4. Return the typed AssistantTurnResponse on success.
 *
 * Why: Keeping fetch/error-handling logic here means ChatPanel never needs to
 * know about HTTP status codes or JSON parsing — it just awaits a typed result
 * or catches a thrown Error.
 *
 * @param chatApiBase  Base URL of the chat-api service (e.g. "http://localhost:3002").
 * @param request      The message history + workflow draft to send.
 * @returns            The structured assistant turn response.
 * @throws             Error with a user-readable message on network or API failure.
 */
export async function sendChatTurn(
  chatApiBase: string,
  request: ChatTurnRequest,
): Promise<AssistantTurnResponse> {
  console.log("[chatApi] sendChatTurn — sending", {
    messageCount: request.messages.length,
    chatApiBase,
  });

  const res = await fetch(`${chatApiBase}/v1/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });

  // Always parse JSON — even error responses have a body with an `error` field.
  const body = (await res.json()) as AssistantTurnResponse & { error?: string };

  if (!res.ok) {
    const errMsg = body.error ?? `Chat failed (${res.status})`;
    console.error("[chatApi] sendChatTurn — server returned error", { status: res.status, errMsg });
    throw new Error(errMsg);
  }

  // Validate the minimum shape the rest of the app expects.
  if (typeof body.message !== "string" || !body.message.trim()) {
    throw new Error("Invalid assistant response: missing message");
  }
  if (typeof body.phase !== "string") {
    throw new Error("Invalid assistant response: missing phase");
  }

  console.log("[chatApi] sendChatTurn — success", {
    phase: body.phase,
    widgetKind: body.widget?.kind ?? "none",
    hasFinalizedJson: Boolean(body.finalizedJson),
  });

  return body;
}
