/**
 * @file routes/healthRoutes.ts
 * @service chat-api
 * @description Liveness and readiness probe routes.
 *
 * Routes:
 *   GET /health    — Liveness probe (always 200, never logged).
 *   GET /v1/ready  — Readiness probe; checks GEMINI_API_KEY is configured.
 */

import { Router } from "express";
import { getGeminiModelName } from "../gemini.js";
import { logger } from "../logger.js";

export const healthRouter = Router();

/**
 * GET /health
 *
 * Simple liveness probe. Returns 200 immediately with a static payload.
 * Not logged — high-frequency probes from Docker/load-balancers would spam
 * the log with no useful signal.
 */
healthRouter.get("/health", (_req, res) => {
  res.json({ ok: true, service: "chat-api" });
});

/**
 * GET /v1/ready
 *
 * Readiness probe that checks whether the Gemini API key is configured.
 * Does NOT make a live API call — just checks env var presence so this
 * endpoint is safe to poll frequently (no cost, no rate-limit risk).
 *
 * Response: { gemini: { configured: boolean, model: string } }
 */
healthRouter.get("/v1/ready", (_req, res) => {
  const configured = Boolean(process.env.GEMINI_API_KEY?.trim());
  const model = getGeminiModelName();

  logger.info(`GET /v1/ready — configured=${configured} model=${model}`, "healthRoutes");
  res.json({ gemini: { configured, model } });
});
