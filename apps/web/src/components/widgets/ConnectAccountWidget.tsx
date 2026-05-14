/**
 * @file components/widgets/ConnectAccountWidget.tsx
 * @app web
 * @description OAuth account connection widget using Pipedream Connect.
 *
 * Opens the Pipedream Connect OAuth popup when the user clicks "Connect <app>".
 * On success, calls onDone with a message containing the provisioned account id
 * (apn_...) so the parent can forward it to the assistant as a chat message.
 *
 * The assistant parses the account id from that message and stores it in
 * workflowPatchJson (trigger.accountId or the relevant step's accountId).
 *
 * Note: In Pipedream "development" environment, the user must be signed in to
 * pipedream.com in the same browser window for OAuth to complete.
 */

import { useState } from "react";
import type { ConnectError, PipedreamClient } from "@pipedream/sdk/browser";

/**
 * ConnectAccountWidget
 *
 * Renders a single "Connect <app>" button.  Clicking it opens the Pipedream
 * Connect OAuth popup via pdBrowser.connectAccount().
 *
 * Success → calls onDone with "I connected <app>. Pipedream account id: apn_..."
 * Error   → displays the error message below the button.
 *
 * @prop pdBrowser  The Pipedream frontend SDK client (from App.tsx).
 * @prop app        App slug to connect (e.g. "slack", "google_sheets").
 * @prop disabled   When true, disables the connect button.
 * @prop onDone     Callback called with a user-facing message on success.
 */
export function ConnectAccountWidget({
  pdBrowser,
  app,
  disabled,
  onDone,
}: {
  pdBrowser: PipedreamClient;
  app: string;
  disabled?: boolean;
  onDone: (detail: string) => void;
}) {
  const [status, setStatus] = useState<string | null>(null);

  /**
   * Initiates the Pipedream Connect OAuth flow for the given app.
   * Clears any previous error before starting a new flow.
   */
  function handleConnect() {
    console.log("[ConnectAccountWidget] Opening OAuth popup for app:", app);
    setStatus(null);

    void pdBrowser.connectAccount({
      app,
      onSuccess: (account) => {
        console.log("[ConnectAccountWidget] OAuth success — accountId:", account.id);
        // The account id string is embedded in the message so the LLM can
        // parse it and set workflowPatchJson.trigger.accountId accordingly.
        onDone(`I connected ${app}. Pipedream account id: ${String(account.id)}.`);
      },
      onError: (err: ConnectError) => {
        console.error("[ConnectAccountWidget] OAuth error for app:", app, err.message);
        setStatus(err.message);
      },
    });
  }

  return (
    <div className="widget-card">
      <p className="muted small">
        Opens Pipedream Connect. In development you must be signed in to pipedream.com in this
        browser.
      </p>
      <button
        type="button"
        className="btn-send"
        disabled={disabled}
        onClick={handleConnect}
      >
        Connect {app}
      </button>
      {status ? <p className="widget-err">{status}</p> : null}
    </div>
  );
}
