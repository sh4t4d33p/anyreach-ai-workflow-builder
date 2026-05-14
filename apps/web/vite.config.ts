import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    headers: {
      // Pipedream docs: if COOP blocks Connect popups, relax for OAuth from iframe
      "Cross-Origin-Opener-Policy": "same-origin-allow-popups",
    },
  },
});
