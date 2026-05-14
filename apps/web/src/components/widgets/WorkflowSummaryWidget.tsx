/**
 * @file components/widgets/WorkflowSummaryWidget.tsx
 * @app web
 * @description Workflow summary and error-policy configuration widget.
 *
 * Shown in the "summarize" phase so the user can review the full workflow
 * definition and optionally configure error-handling policies (retry + onFailure)
 * before finalising.
 *
 * This widget is the only one that directly mutates the workflowDraft — via the
 * onPoliciesApply callback — because policy values are collected in local form
 * state and must be applied to the draft atomically with the next chat message.
 *
 * Structure:
 *  - Trigger section: raw JSON of draft.trigger.
 *  - Steps section: ordered list of step id + summary.
 *  - Error handling section: form controls for retry count, failure strategy,
 *    and optional fallback step id.
 *  - "Apply policies" button: merges form values into the draft and submits
 *    a chat message describing the change.
 *  - "Continue in chat" button: skips policy editing and advances the session.
 */

import { useState } from "react";
import type { WorkflowDraft } from "../../types/session";
import { mergeWorkflowDraft } from "../../lib/mergeWorkflowDraft";

/**
 * WorkflowSummaryWidget
 *
 * @prop draft           The current workflow draft to display.
 * @prop disabled        When true, disables all form controls and buttons.
 * @prop onPoliciesApply Called with (updatedDraft, chatMessage) when the user
 *                       applies policy changes.  The parent updates state and
 *                       submits the message as a chat turn.
 * @prop onContinue      Called with a chat message when the user skips policy
 *                       editing and wants to proceed (e.g. to finalize).
 */
export function WorkflowSummaryWidget({
  draft,
  disabled,
  onPoliciesApply,
  onContinue,
}: {
  draft: WorkflowDraft;
  disabled?: boolean;
  onPoliciesApply: (next: WorkflowDraft, userLine: string) => void;
  onContinue: (line: string) => void;
}) {
  // Local form state for the error-handling policy controls.
  // These are kept as strings for easier <input> binding; parsed on submit.
  const [retries, setRetries] = useState<string>("");
  const [strategy, setStrategy] = useState<"stop" | "fallback">("stop");
  const [fallbackId, setFallbackId] = useState("");

  /**
   * Builds the policies object from the current form state, merges it into
   * the draft via mergeWorkflowDraft, and fires onPoliciesApply.
   *
   * Retry is disabled when the input is blank or zero — null means "no retry".
   * onFailure is always set so the server has a concrete strategy even if the
   * user leaves it at the default "stop" value.
   */
  function applyPolicies() {
    const max = retries.trim() === "" ? null : Number.parseInt(retries, 10);

    const policies = {
      retry:
        max !== null && Number.isFinite(max) && max > 0
          ? { maxAttempts: max, backoffSeconds: 2 }
          : null,
      onFailure:
        strategy === "fallback" && fallbackId.trim()
          ? { strategy: "fallback" as const, fallbackStepId: fallbackId.trim() }
          : { strategy: "stop" as const },
    };

    console.log("[WorkflowSummaryWidget] Applying policies", policies);

    const next = mergeWorkflowDraft(draft, { policies });
    const line = `I set error policies: retry=${
      policies.retry ? `${policies.retry.maxAttempts}x` : "none"
    }, onFailure=${JSON.stringify(policies.onFailure)}.`;

    onPoliciesApply(next, line);
  }

  return (
    <div className="widget-card widget-summary">
      {/* Trigger section */}
      <div className="widget-summary-block">
        <h4 className="widget-h4">Trigger</h4>
        <pre className="widget-snippet">{JSON.stringify(draft.trigger, null, 2)}</pre>
      </div>

      {/* Steps section */}
      <div className="widget-summary-block">
        <h4 className="widget-h4">Steps ({draft.steps.length})</h4>
        <ol className="widget-step-list">
          {draft.steps.map((s, i) => (
            <li key={i}>
              <code>{String((s as { id?: unknown }).id ?? i)}</code> —{" "}
              {String((s as { summary?: unknown }).summary ?? JSON.stringify(s))}
            </li>
          ))}
        </ol>
      </div>

      {/* Error handling section (Phase 8 bonus) */}
      <div className="widget-summary-block">
        <h4 className="widget-h4">Error handling</h4>

        <label className="widget-field">
          Max retries (blank = none)
          <input
            type="number"
            min={0}
            value={retries}
            onChange={(e) => setRetries(e.target.value)}
            disabled={disabled}
          />
        </label>

        <label className="widget-field">
          On failure
          <select
            value={strategy}
            disabled={disabled}
            onChange={(e) => setStrategy(e.target.value as "stop" | "fallback")}
          >
            <option value="stop">stop</option>
            <option value="fallback">fallback step</option>
          </select>
        </label>

        {/* Fallback step id field — only shown when strategy is "fallback". */}
        {strategy === "fallback" ? (
          <label className="widget-field">
            Fallback step id
            <input
              value={fallbackId}
              onChange={(e) => setFallbackId(e.target.value)}
              disabled={disabled}
            />
          </label>
        ) : null}

        <button
          type="button"
          className="btn-secondary"
          disabled={disabled}
          onClick={applyPolicies}
        >
          Apply policies &amp; tell assistant
        </button>
      </div>

      {/* Continue button — skips policy editing and advances the conversation. */}
      <div className="widget-summary-actions">
        <button
          type="button"
          className="btn-send"
          disabled={disabled}
          onClick={() => {
            console.log("[WorkflowSummaryWidget] User confirmed summary — continuing");
            onContinue("Confirmed — this summary looks correct. Proceed.");
          }}
        >
          Continue in chat
        </button>
      </div>
    </div>
  );
}
