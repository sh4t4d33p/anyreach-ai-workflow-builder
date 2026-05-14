import { useMemo } from "react";
import { createFrontendClient } from "@pipedream/sdk/browser";
import { ChatPanel } from "./components/ChatPanel";
import { fetchConnectToken } from "./lib/pipedreamApi";

const apiBase = import.meta.env.VITE_PIPEDREAM_API_URL ?? "http://localhost:3001";
const chatBase = import.meta.env.VITE_CHAT_API_URL ?? "http://localhost:3002";

// Fixed for the lifetime of the session — no UI to change it.
const EXTERNAL_USER_ID = "demo-local-user";

export default function App() {
  const pdBrowser = useMemo(
    () =>
      createFrontendClient({
        projectEnvironment: "development",
        externalUserId: EXTERNAL_USER_ID,
        tokenCallback: (opts) => fetchConnectToken(apiBase, opts.externalUserId),
      }),
    [],
  );

  return (
    <div className="wrap">
      <h1>Workflow Builder</h1>

      <ChatPanel
        chatApiBase={chatBase}
        pipedreamApiBase={apiBase}
        pdBrowser={pdBrowser}
        externalUserId={EXTERNAL_USER_ID}
      />
    </div>
  );
}
