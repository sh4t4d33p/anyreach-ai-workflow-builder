/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PIPEDREAM_API_URL: string;
  readonly VITE_CHAT_API_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
