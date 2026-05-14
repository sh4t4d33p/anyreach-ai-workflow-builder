/**
 * @file index.ts
 * @service chat-api
 * @description Express server entry point for the chat-api service.
 *
 * Responsibilities:
 *  - Load environment variables from the project root .env file.
 *  - Create and configure the Express application (CORS, JSON body parsing).
 *  - Mount all route modules.
 *  - Start the TCP listener.
 *
 * Route modules:
 *  - healthRoutes → GET /health, GET /v1/ready
 *  - chatRoutes   → POST /v1/chat
 *
 * Why dotenv is loaded before other imports:
 *  ESM hoists all `import` statements, so environment variables must be read
 *  from the file system before any module that consumes them is evaluated.
 *  The two dotenv.config() calls cover monorepo root (.env three levels up)
 *  and service-local .env (two levels up) — whichever exists wins.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

// Resolve __dirname in ESM context (not available natively in ES modules).
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load .env — try monorepo root first, then service-local.
// Both calls are intentional: dotenv.config() is a no-op if the file does
// not exist, so order determines precedence without throwing.
dotenv.config({ path: path.join(__dirname, "../../../.env") });
dotenv.config({ path: path.join(__dirname, "../../.env") });

import cors from "cors";
import express from "express";
import { healthRouter } from "./routes/healthRoutes.js";
import { chatRouter } from "./routes/chatRoutes.js";
import { getGeminiModelName } from "./gemini.js";
import { logger } from "./logger.js";
import { DEFAULT_CHAT_API_PORT, DEFAULT_WEB_ORIGIN, REQUEST_BODY_LIMIT } from "./constants.js";

// ---------------------------------------------------------------------------
// App setup
// ---------------------------------------------------------------------------

const app = express();
const port = Number(process.env.CHAT_API_PORT ?? DEFAULT_CHAT_API_PORT);
const webOrigin = process.env.WEB_ORIGIN ?? DEFAULT_WEB_ORIGIN;

logger.info(`Configuring CORS for origin: ${webOrigin}`);

// Allow requests from the configured web origin and any localhost port
// (the latter covers Vite's dev server regardless of which port it binds to).
app.use(
  cors({
    origin: [webOrigin, /^http:\/\/localhost:\d+$/],
    credentials: true,
  }),
);

// Parse JSON bodies up to REQUEST_BODY_LIMIT.
// Larger payloads are rejected with 413 — the client enforces MAX_INPUT_LENGTH.
app.use(express.json({ limit: REQUEST_BODY_LIMIT }));

// ---------------------------------------------------------------------------
// Route modules
// ---------------------------------------------------------------------------

/**
 * Mount all route modules.
 *
 * Each module registers its own full path prefixes so this file stays free
 * of route-level logic — index.ts only wires things together.
 */
app.use(healthRouter); // GET  /health, GET /v1/ready
app.use(chatRouter);   // POST /v1/chat

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------

app.listen(port, () => {
  logger.info(`chat-api listening on http://localhost:${port}`);
  logger.info(`CORS origin: ${webOrigin}`);
  logger.info(`Gemini model: ${getGeminiModelName()}`);
});
