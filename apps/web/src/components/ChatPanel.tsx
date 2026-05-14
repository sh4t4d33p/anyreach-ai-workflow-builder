/**
 * @file components/ChatPanel.tsx
 * @app web
 * @description Main chat interface for the workflow builder.
 *
 * ChatPanel is the primary UI surface.  It manages:
 *  - The conversation message list (user + assistant bubbles).
 *  - The in-memory workflow draft (merged from server patches each turn).
 *  - The chat input textarea and send button.
 *  - Rendering the latest assistant widget (interactive) vs stale widgets
 *    (read-only label showing kind + "completed").
 *  - Rendering FinalizedJsonBlock when the assistant finalises the workflow.
 *
 * Data flow:
 *  User types message → send() → sendChatTurn() (chatApi.ts) → server
 *  → AssistantTurnResponse → normalizeTurn() → merge draft → append messages
 *
 * Separation of concerns:
 *  - Network calls live in lib/chatApi.ts.
 *  - Draft merging lives in lib/mergeWorkflowDraft.ts.
 *  - Widget rendering is delegated to WidgetRouter.
 *  - Finalized JSON display is handled by FinalizedJsonBlock.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PipedreamClient } from "@pipedream/sdk/browser";
import type { AssistantTurnResponse, ChatPhase } from "../types/assistantTurn";
import type { ChatMessage, WorkflowDraft } from "../types/session";
import { emptyWorkflowDraft } from "../types/session";
import { mergeWorkflowDraft } from "../lib/mergeWorkflowDraft";
import { sendChatTurn } from "../lib/chatApi";
import { WidgetRouter } from "./widgets/WidgetRouter";
import { FinalizedJsonBlock } from "./FinalizedJsonBlock";
import { MAX_CHAT_INPUT_LENGTH } from "../constants";

/** All valid chat phases in order — used to validate server-returned phase values. */
const PHASES: ChatPhase[] = ["clarify", "configure", "summarize", "finalize"];

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Normalises a raw server AssistantTurnResponse, guarding against unexpected
 * or missing fields that could crash the UI.
 *
 * Why: The server is trusted but we defensively normalise so that a future
 * schema change does not silently corrupt the UI state.
 *
 * @param body  Raw response from the chat-api endpoint.
 * @returns     Validated and defaulted AssistantTurnResponse.
 */
function normalizeTurn(body: AssistantTurnResponse): AssistantTurnResponse {
  // Fall back to "clarify" if the server returns an unknown phase.
  const phase = PHASES.includes(body.phase) ? body.phase : "clarify";
  return {
    message: body.message.trim(),
    phase,
    widget: body.widget ?? null,
    workflowPatch: body.workflowPatch ?? null,
    finalizedJson: body.finalizedJson,
  };
}

/**
 * Creates a new user ChatMessage from raw text content.
 * id is a random UUID; createdAt is the current epoch timestamp.
 */
function nextUserMessage(content: string): ChatMessage {
  return {
    id: crypto.randomUUID(),
    role: "user",
    content,
    createdAt: Date.now(),
  };
}

/**
 * Creates a new assistant ChatMessage from a normalised turn response.
 * Embeds the full turn so the message list retains widget and patch data.
 */
function nextAssistantMessage(turn: AssistantTurnResponse): ChatMessage {
  return {
    id: crypto.randomUUID(),
    role: "assistant",
    content: turn.message,
    createdAt: Date.now(),
    assistantTurn: turn,
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/** Props accepted by ChatPanel. */
type Props = {
  chatApiBase: string;
  pipedreamApiBase: string;
  pdBrowser: PipedreamClient;
  externalUserId: string;
};

/**
 * ChatPanel
 *
 * Renders the full chat interface including message history, interactive
 * widget area (latest turn only), finalized JSON block (finalize phase),
 * a live workflow draft sidebar, and the message composer.
 *
 * Key implementation notes:
 *  - messagesRef and draftRef are kept in sync with state to give stable
 *    references inside async callbacks without causing stale-closure bugs.
 *  - runTurn() is the core async function: calls the API, merges the draft,
 *    appends the assistant message, and handles errors.
 *  - Only the last assistant message's widget is interactive — earlier widgets
 *    show a "completed" badge to preserve the conversation context visually.
 */
export function ChatPanel({ chatApiBase, pipedreamApiBase, pdBrowser, externalUserId }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [workflowDraft, setWorkflowDraft] = useState<WorkflowDraft>(() => emptyWorkflowDraft());
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Refs provide stable access to current state inside async callbacks,
  // avoiding the common React "stale closure" pitfall with useCallback.
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const draftRef = useRef(workflowDraft);
  draftRef.current = workflowDraft;

  /** The most recent assistant turn — used to display the phase pill. */
  const lastAssistantTurn = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role === "assistant" && m.assistantTurn) return m.assistantTurn;
    }
    return null;
  }, [messages]);

  /**
   * Id of the last assistant message — used to determine which widget is
   * still interactive vs showing the "completed" stale badge.
   */
  const lastAssistantMessageId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "assistant") return messages[i].id;
    }
    return null;
  }, [messages]);

  // Auto-scroll the message list to the bottom whenever messages or
  // loading state changes so the user always sees the latest content.
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  /**
   * Executes a single chat turn: sends the full message history + draft to
   * the server, merges the returned workflow patch into the draft, and
   * appends the assistant response to the message list.
   *
   * On error: removes the last user message from history (optimistic rollback)
   * and surfaces the error in the error banner.
   *
   * @param nextHist  The updated message history including the new user message.
   */
  const runTurn = useCallback(
    async (nextHist: ChatMessage[]) => {
      console.log("[ChatPanel] runTurn — starting", { messageCount: nextHist.length });
      setLoading(true);
      setError(null);

      try {
        // sendChatTurn handles fetch, error extraction, and response typing.
        const body = await sendChatTurn(chatApiBase, {
          messages: nextHist.map(({ role, content }) => ({ role, content })),
          workflowDraft: draftRef.current,
        });

        const turn = normalizeTurn(body);

        // Merge the server-returned patch into the local draft.
        // Using the functional updater ensures we merge against the latest
        // state even if multiple turns are in-flight (not typical, but safe).
        setWorkflowDraft((d) => {
          const merged = mergeWorkflowDraft(d, turn.workflowPatch);
          draftRef.current = merged;
          console.log("[ChatPanel] Draft updated", {
            patchKeys: turn.workflowPatch ? Object.keys(turn.workflowPatch) : [],
          });
          return merged;
        });

        setMessages([...nextHist, nextAssistantMessage(turn)]);
        console.log("[ChatPanel] runTurn — complete", {
          phase: turn.phase,
          widgetKind: turn.widget?.kind ?? "none",
          hasFinalizedJson: Boolean(turn.finalizedJson),
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("[ChatPanel] runTurn — error", msg, e);
        setError(msg);
        // Roll back: remove the optimistically-appended user message.
        setMessages(nextHist.slice(0, -1));
      } finally {
        setLoading(false);
      }
    },
    [chatApiBase],
  );

  /**
   * Submits a user message from an external source (e.g. a widget "onDone"
   * callback) without going through the textarea — used by widgets like
   * AppPickerWidget and ConnectAccountWidget.
   */
  const submitUserMessage = useCallback(
    async (text: string) => {
      if (loading) return;
      console.log("[ChatPanel] submitUserMessage", { text });
      const userMsg = nextUserMessage(text);
      const nextHist = [...messagesRef.current, userMsg];
      setMessages(nextHist);
      await runTurn(nextHist);
    },
    [loading, runTurn],
  );

  /**
   * Applies a draft policy update from WorkflowSummaryWidget and immediately
   * submits a chat message describing the change.
   *
   * Used instead of submitUserMessage when a widget mutates the draft before
   * sending — ensures the server sees the updated draft alongside the message.
   */
  const submitPoliciesThenMessage = useCallback(
    async (nextDraft: WorkflowDraft, line: string) => {
      if (loading) return;
      console.log("[ChatPanel] submitPoliciesThenMessage", { line });
      draftRef.current = nextDraft;
      setWorkflowDraft(nextDraft);
      const userMsg = nextUserMessage(line);
      const nextHist = [...messagesRef.current, userMsg];
      setMessages(nextHist);
      await runTurn(nextHist);
    },
    [loading, runTurn],
  );

  /** Resets the entire session: clears messages, draft, input, and errors. */
  const resetSession = useCallback(() => {
    console.log("[ChatPanel] resetSession — clearing session state");
    setMessages([]);
    setWorkflowDraft(emptyWorkflowDraft());
    draftRef.current = emptyWorkflowDraft();
    setInput("");
    setError(null);
    setLoading(false);
  }, []);

  /**
   * Sends the current textarea content as a new user message.
   * Validates length before sending; trims whitespace.
   */
  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;

    if (text.length > MAX_CHAT_INPUT_LENGTH) {
      setError(`Message too long (max ${MAX_CHAT_INPUT_LENGTH} characters).`);
      return;
    }

    console.log("[ChatPanel] send — user submitted message", { length: text.length });
    const userMsg = nextUserMessage(text);
    const nextHist = [...messagesRef.current, userMsg];
    setMessages(nextHist);
    setInput("");
    setError(null);
    await runTurn(nextHist);
  }, [input, loading, runTurn]);

  return (
    <section className="chat-shell" aria-label="Workflow chat">
      <div className="chat-head">
        <h2 className="h2 chat-title">Workflow Builder</h2>
        <div className="chat-head-actions">
          <button type="button" className="btn-secondary" onClick={resetSession}>
            New session
          </button>
        </div>
      </div>
      <p className="muted chat-sub">
        Chat-driven workflow authoring. The latest assistant widget is interactive.
      </p>

      {lastAssistantTurn ? (
        <div className="phase-bar" aria-live="polite">
          <span className="phase-pill">Phase: {lastAssistantTurn.phase}</span>
        </div>
      ) : null}

      {error ? (
        <div className="chat-error" role="alert">
          {error}
        </div>
      ) : null}

      <div className="chat-layout">
        <div className="chat-main">
          <div className="chat-messages" ref={listRef}>
            {messages.length === 0 ? (
              <p className="muted chat-empty">
                Example: "I want a workflow: when a new row is added to a Google Sheet, post a summary to
                Slack #sales."
              </p>
            ) : (
              messages.map((m) => (
                <div key={m.id} className={`chat-bubble chat-bubble--${m.role}`}>
                  <span className="chat-role">{m.role === "user" ? "You" : "Assistant"}</span>
                  <div className="chat-text">{m.content}</div>

                  {/* Widget: only the latest assistant message's widget is interactive. */}
                  {m.role === "assistant" && m.assistantTurn?.widget ? (
                    m.id === lastAssistantMessageId ? (
                      <div className="widget-live">
                        <div className="widget-live-head">
                          <span className="widget-preview-label">Widget</span>{" "}
                          <code>{m.assistantTurn.widget.kind}</code>
                          {m.assistantTurn.widget.title ? (
                            <>
                              {" "}
                              — <span className="widget-preview-title">{m.assistantTurn.widget.title}</span>
                            </>
                          ) : null}
                        </div>
                        <WidgetRouter
                          widget={m.assistantTurn.widget}
                          pipedreamApiBase={pipedreamApiBase}
                          pdBrowser={pdBrowser}
                          externalUserId={externalUserId}
                          workflowDraft={workflowDraft}
                          disabled={loading}
                          onUserCommit={submitUserMessage}
                          onPoliciesApply={submitPoliciesThenMessage}
                        />
                      </div>
                    ) : (
                      <div className="widget-stale">
                        <span className="widget-preview-label">Widget</span>{" "}
                        <code>{m.assistantTurn.widget.kind}</code>
                        <span className="muted small"> (completed)</span>
                      </div>
                    )
                  ) : null}

                  {/* Finalized JSON block: rendered when the assistant exports the workflow. */}
                  {m.role === "assistant" && m.assistantTurn?.finalizedJson ? (
                    <FinalizedJsonBlock json={m.assistantTurn.finalizedJson} />
                  ) : null}
                </div>
              ))
            )}

            {/* Loading indicator while awaiting the server response. */}
            {loading ? (
              <div className="chat-bubble chat-bubble--assistant chat-bubble--pending">
                <span className="chat-role">Assistant</span>
                <div className="chat-text">Thinking…</div>
              </div>
            ) : null}
          </div>

          <div className="chat-composer">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Describe or revise your workflow…"
              rows={3}
              disabled={loading}
              maxLength={MAX_CHAT_INPUT_LENGTH}
              onKeyDown={(e) => {
                // Submit on Enter; Shift+Enter inserts a newline.
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
            />
            <button
              type="button"
              className="btn-send"
              disabled={loading || !input.trim()}
              onClick={() => void send()}
            >
              Send
            </button>
          </div>
        </div>

        {/* Live draft sidebar — shows the current workflowDraft JSON. */}
        <aside className="chat-side" aria-label="Workflow draft preview">
          <h3 className="h3">Workflow draft</h3>
          <pre className="draft-json">{JSON.stringify(workflowDraft, null, 2)}</pre>
          <p className="muted small">
            Merged from <code>workflowPatch</code> each turn. Policies can be edited from the workflow summary
            widget.
          </p>
        </aside>
      </div>
    </section>
  );
}
