/**
 * @file components/widgets/ConditionalBuilderWidget.tsx
 * @app web
 * @description Simple branch-condition builder widget.
 *
 * Allows the user to define a single if/then/else branch condition in a
 * structured form, which is then serialised to plain text and sent to the
 * assistant as a chat message.  The assistant parses the text and updates the
 * workflowPatchJson conditions array accordingly.
 *
 * This approach (form → text → assistant) keeps the branch logic in the LLM
 * rather than in the client, which means complex nesting, references to step
 * outputs, and validation are all handled server-side.
 *
 * Form fields:
 *  - Left operand: a field name or JSON path (e.g. "row.Status").
 *  - Operator: "equals" or "contains".
 *  - Right operand: the comparison value (e.g. "Won").
 *  - Then step id: the step to run when the condition is true.
 *  - Else step id: the step to run when the condition is false.
 */

import { useState } from "react";

/**
 * ConditionalBuilderWidget
 *
 * @prop disabled  When true, all form controls and the submit button are disabled.
 * @prop onDone    Callback fired with a plain-text branch description when the
 *                 user submits.  The text is sent as a user chat message.
 */
export function ConditionalBuilderWidget({
  disabled,
  onDone,
}: {
  disabled?: boolean;
  onDone: (detail: string) => void;
}) {
  const [left, setLeft] = useState("");
  const [op, setOp] = useState<"equals" | "contains">("equals");
  const [right, setRight] = useState("");
  const [thenId, setThenId] = useState("");
  const [elseId, setElseId] = useState("");

  /**
   * Serialises the form values to a plain-text branch description and fires
   * onDone.  "TBD" is used as a placeholder for blank step ids so the
   * assistant knows to ask for clarification rather than silently dropping them.
   */
  function submit() {
    const line = `Add/update a branch: if ${left.trim()} ${op} "${right.trim()}" then run step "${
      thenId.trim() || "TBD"
    }" else "${elseId.trim() || "TBD"}".`;

    console.log("[ConditionalBuilderWidget] Submitting branch condition:", line);
    onDone(line);
  }

  return (
    <div className="widget-card">
      <p className="muted small">
        Describe a simple branch. Values are sent to the assistant as plain text.
      </p>

      <label className="widget-field">
        Field / JSON path (left)
        <input
          value={left}
          onChange={(e) => setLeft(e.target.value)}
          placeholder="row.Status"
          disabled={disabled}
        />
      </label>

      <label className="widget-field">
        Operator
        <select
          value={op}
          onChange={(e) => setOp(e.target.value as "equals" | "contains")}
          disabled={disabled}
        >
          <option value="equals">equals</option>
          <option value="contains">contains</option>
        </select>
      </label>

      <label className="widget-field">
        Value (right)
        <input
          value={right}
          onChange={(e) => setRight(e.target.value)}
          placeholder="Won"
          disabled={disabled}
        />
      </label>

      <label className="widget-field">
        Then step id
        <input
          value={thenId}
          onChange={(e) => setThenId(e.target.value)}
          placeholder="notify_win"
          disabled={disabled}
        />
      </label>

      <label className="widget-field">
        Else step id
        <input
          value={elseId}
          onChange={(e) => setElseId(e.target.value)}
          placeholder="notify_other"
          disabled={disabled}
        />
      </label>

      {/* Require at least left and right to be filled before submitting. */}
      <button
        type="button"
        className="btn-send"
        disabled={disabled || !left.trim() || !right.trim()}
        onClick={submit}
      >
        Send branch to assistant
      </button>
    </div>
  );
}
