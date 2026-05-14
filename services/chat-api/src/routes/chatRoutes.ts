/**
 * @file routes/chatRoutes.ts
 * @service chat-api
 * @description Express router for LLM chat turn endpoints.
 *
 * Routes:
 *   POST /v1/chat — Main chat-turn endpoint (message history → structured response).
 */

import { Router } from "express";
import { parseChatRequestBody, runChatTurn } from "../chatTurn.js";
import { logger } from "../logger.js";

export const chatRouter = Router();

/**
 * POST /v1/chat
 *
 * Main chat-turn endpoint. Accepts the full message history and the current
 * workflow draft, runs a Gemini LLM call, and returns a structured response
 * containing the assistant message, phase, widget, workflow patch, and
 * optionally the finalised workflow JSON.
 *
 * Request body : { messages: ChatMessage[], workflowDraft: object }
 * Response     : AssistantTurnResponse (see assistantNormalize.ts)
 *
 * Error classification:
 *  - 400: Request validation failures (malformed messages, too many messages).
 *  - 502: LLM failures (Gemini error, unparseable response, hallucinated schema).
 */
chatRouter.post("/v1/chat", async (req, res) => {
  logger.info("POST /v1/chat — received chat turn request", "chatRoutes");

  try {
    const { messages, workflowDraft } = parseChatRequestBody(req.body);

    logger.info(`POST /v1/chat — running turn with ${messages.length} message(s)`, "chatRoutes");

    const turn = await runChatTurn({ messages, workflowDraft });

    logger.info(
      `POST /v1/chat — turn complete: phase="${turn.phase}" widget="${turn.widget?.kind ?? "none"}"`,
      "chatRoutes",
    );

    res.json(turn);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Chat failed";

    // Classify the error: validation/parse errors are the caller's fault (400);
    // Gemini connectivity or model errors are upstream failures (502).
    const code =
      msg.includes("must") ||
      msg.includes("Invalid") ||
      msg.includes("object") ||
      msg.includes("array") ||
      msg.includes("Model JSON") ||
      msg.includes("invalid JSON")
        ? 400
        : 502;

    logger.error(`POST /v1/chat — failed with HTTP ${code}: ${msg}`, "chatRoutes", e);
    res.status(code).json({ error: msg });
  }
});
