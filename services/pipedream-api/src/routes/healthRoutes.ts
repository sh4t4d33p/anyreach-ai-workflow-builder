/**
 * @file routes/healthRoutes.ts
 * @service pipedream-api
 * @description Liveness probe route.
 *
 * Routes:
 *   GET /health — Always returns 200. Used by Docker/load-balancer probes.
 */

import { Router } from "express";

export const healthRouter = Router();

/**
 * GET /health
 *
 * Simple liveness probe. Returns 200 immediately with a static payload.
 * Not logged — high-frequency probes from Docker/load-balancers would spam
 * the log with no useful signal.
 */
healthRouter.get("/health", (_req, res) => {
  res.json({ ok: true, service: "pipedream-api" });
});
