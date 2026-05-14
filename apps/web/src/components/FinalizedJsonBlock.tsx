/**
 * @file components/FinalizedJsonBlock.tsx
 * @app web
 * @description Read-only display card for a finalised workflow JSON definition.
 *
 * Rendered inside a chat bubble when the assistant returns a finalized workflow
 * (phase = "finalize" and server-side Zod validation passed).  Gives the user
 * two export actions: copy to clipboard and download as workflow.json.
 *
 * This component is intentionally stateless — it only receives the JSON object
 * as a prop and provides no editing capability.
 */

/**
 * Props for FinalizedJsonBlock.
 *
 * @prop json  The fully-validated workflow definition object to display.
 */
type Props = {
  json: Record<string, unknown>;
};

/**
 * FinalizedJsonBlock
 *
 * Renders a green-bordered card containing:
 *  - A header row with a "Finalized workflow definition" label and action buttons.
 *  - A scrollable dark-background pre block showing the pretty-printed JSON.
 *
 * Copy: writes the JSON string to the system clipboard via the Clipboard API.
 * Download: creates a temporary object URL and triggers an <a> click to save
 *   the file as "workflow.json" — no server round-trip required.
 */
export function FinalizedJsonBlock({ json }: Props) {
  const text = JSON.stringify(json, null, 2);

  /** Copies the workflow JSON string to the system clipboard. */
  function copy() {
    console.log("[FinalizedJsonBlock] Copying workflow JSON to clipboard");
    void navigator.clipboard.writeText(text);
  }

  /**
   * Triggers a browser file download of the workflow JSON as "workflow.json".
   * Uses a Blob + object URL so no server round-trip is needed.
   */
  function download() {
    console.log("[FinalizedJsonBlock] Triggering workflow.json download");
    const blob = new Blob([text], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "workflow.json";
    a.click();
    // Revoke immediately after the click so the browser can free the memory.
    URL.revokeObjectURL(url);
  }

  return (
    <div className="finalized-json-block">
      <div className="finalized-json-head">
        <strong>Finalized workflow definition</strong>
        <div className="finalized-json-actions">
          <button type="button" className="btn-secondary" onClick={copy}>
            Copy
          </button>
          <button type="button" className="btn-secondary" onClick={download}>
            Download
          </button>
        </div>
      </div>
      <pre className="finalized-json-body">{text}</pre>
    </div>
  );
}