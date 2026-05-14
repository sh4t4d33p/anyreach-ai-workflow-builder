/**
 * @file index.ts
 * @service pipedream-api
 * @description Express server entry point for the pipedream-api service.
 *
 * Responsibilities:
 *  - Load environment variables from the project root .env file.
 *  - Create and configure the Express application (CORS, JSON body parsing).
 *  - Mount all route modules.
 *  - Start the TCP listener.
 *
 * Route modules:
 *  - healthRoutes   → GET /health
 *  - connectRoutes  → /v1/connect/tokens
 *  - appRoutes      → /v1/apps, /v1/actions, /v1/triggers
 *  - componentRoutes → /v1/actions/:key, /v1/triggers/:key,
 *                      /v1/components/resolve, /v1/components/configure-prop
 *  - accountRoutes  → /v1/accounts
 *
 * Why dotenv is loaded before other imports:
 *  ESM hoists all `import` statements, so environment variables must be
 *  loaded before any module that reads them is evaluated.  Two dotenv.config()
 *  calls cover both monorepo root and service-local .env files.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

// Resolve __dirname in ESM context (not natively available in ES modules).
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load .env — monorepo root first, then service-local.
// dotenv.config() is a no-op if the file doesn't exist, so order sets precedence.
dotenv.config({ path: path.join(__dirname, "../../../.env") });
dotenv.config({ path: path.join(__dirname, "../../.env") });

import cors from "cors";
import express from "express";
import { healthRouter } from "./routes/healthRoutes.js";
import { connectRouter } from "./routes/connectRoutes.js";
import { appRouter } from "./routes/appRoutes.js";
import { componentRouter } from "./routes/componentRoutes.js";
import { accountRouter } from "./routes/accountRoutes.js";
import { logger } from "./logger.js";
import { DEFAULT_PIPEDREAM_API_PORT, DEFAULT_WEB_ORIGIN, REQUEST_BODY_LIMIT } from "./constants.js";

// ---------------------------------------------------------------------------
// App setup
// ---------------------------------------------------------------------------

const app = express();
const port = Number(process.env.PIPEDREAM_API_PORT ?? DEFAULT_PIPEDREAM_API_PORT);
const webOrigin = process.env.WEB_ORIGIN ?? DEFAULT_WEB_ORIGIN;

logger.info(`Configuring CORS for origin: ${webOrigin}`);

// Allow requests from the configured web origin and any localhost port
// (covers Vite dev server regardless of which port it picks).
app.use(
  cors({
    origin: [webOrigin, /^http:\/\/localhost:\d+$/],
    credentials: true,
  }),
);

// Parse JSON bodies up to REQUEST_BODY_LIMIT.
app.use(express.json({ limit: REQUEST_BODY_LIMIT }));

// ---------------------------------------------------------------------------
// Route modules
// ---------------------------------------------------------------------------

/**
 * Mount all route modules.
 *
 * Each module registers its own path prefixes, so mounting at "/" is
 * intentional — the route files own their full paths (e.g. "/v1/apps").
 * This makes each route file independently readable without needing to
 * cross-reference the index for the effective URL.
 */
app.use(healthRouter);    // GET  /health
app.use(connectRouter);   // POST /v1/connect/tokens
app.use(appRouter);       // GET  /v1/apps, /v1/actions, /v1/triggers
app.use(componentRouter); // GET  /v1/actions/:key, /v1/triggers/:key
                          // GET  /v1/components/resolve
                          // POST /v1/components/configure-prop
app.use(accountRouter);   // GET  /v1/accounts

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------

app.listen(port, () => {
  logger.info(`pipedream-api listening on http://localhost:${port}`);
  logger.info(`CORS origin: ${webOrigin}`);
});