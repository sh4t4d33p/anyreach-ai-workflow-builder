/**
 * @file chatTurn.ts
 * @service chat-api
 * @description Core chat-turn orchestration: validates the request, runs Zod
 * validation on the workflow draft, calls Gemini, parses the response, and
 * attaches finalizedJson when appropriate.
 *
 * This is the heart of the chat-api.  A "turn" is one user message → one
 * assistant response.  Each turn:
 *  1. Validates the incoming request shape.
 *  2. Runs the workflow draft through the Zod validator (Layer 1 + Layer 2).
 *  3. Injects validation errors into the Gemini system instruction.
 *  4. Sends the message history to Gemini and parses the structured response.
 *  5. Retries on rate-limit (429) errors with back-off.
 *  6. Attaches finalizedJson when the model sets phase="finalize" AND the
 *     draft passed validation — this is the export-ready workflow JSON.
 *
 * Separation of concerns:
 *  - gemini.ts       → Gemini client/model name (configuration).
 *  - prompt.ts       → System instruction assembly (prompt engineering).
 *  - workflowValidator.ts → Draft validation (domain rules).
 *  - assistantNormalize.ts → Model output parsing and typing.
 *  - chatTurn.ts     → Orchestration: ties all of the above together.
 */

import { getGeminiClient, getGeminiModelName } from "./gemini.js";
import {
  assistantTurnSchema,
  parseAssistantTurnFromModelJson,
  type AssistantTurnResponse,
} from "./assistantNormalize.js";
import { buildSystemInstruction } from "./prompt.js";
import { validateWorkflowDraft } from "./workflowValidator.js";
import { logger } from "./logger.js";
import {
  MAX_MESSAGES,
  MAX_CONTENT_LENGTH,
  MAX_LLM_RETRY_ATTEMPTS,
  DEFAULT_RETRY_DELAY_MS,
  MAX_RETRY_DELAY_MS,
} from "./constants.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Allowed roles in the chat history. */
export type ChatTurnRole = "user" | "assistant";

/** A single message in the conversation history. */
export type ChatTurnMessage = {
  role: ChatTurnRole;
  content: string;
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Returns a promise that resolves after `ms` milliseconds.
 * Used to implement back-off between Gemini retry attempts.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Detects whether an error from the Gemini SDK is a rate-limit error that
 * should trigger a retry.
 *
 * Gemini rate-limit errors surface as HTTP 429, RESOURCE_EXHAUSTED gRPC
 * status, or "Too Many Requests" messages — we match all variants.
 *
 * @param err  Any caught error value.
 * @returns    true if the error is a retryable rate-limit condition.
 */
function isGeminiRateLimitError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    /\b429\b/.test(msg) ||
    /Too Many Requests/i.test(msg) ||
    /RESOURCE_EXHAUSTED/i.test(msg) ||
    /quota/i.test(msg)
  );
}

/**
 * Extracts the suggested retry delay from a Gemini error message.
 *
 * Gemini often includes "retry in 29.4s" or "retryDelay":"29s" in the error
 * text.  We parse this hint so we respect the server's back-off guidance
 * rather than using an arbitrary fixed delay.
 *
 * Falls back to DEFAULT_RETRY_DELAY_MS when no hint is present, and caps at
 * MAX_RETRY_DELAY_MS to prevent freezing.
 *
 * @param err  The caught error value.
 * @returns    Recommended sleep duration in milliseconds.
 */
function parseRetryDelayMs(err: unknown): number {
  const msg = err instanceof Error ? err.message : String(err);
  const secMatch = /retry in ([\d.]+)\s*s/i.exec(msg);

  if (secMatch) {
    const sec = Number.parseFloat(secMatch[1]);
    if (Number.isFinite(sec) && sec > 0) {
      // Add 750ms padding to avoid racing the rate-limit window reset.
      const delay = Math.min(Math.ceil(sec * 1000) + 750, MAX_RETRY_DELAY_MS);
      logger.info(`Parsed Gemini retry hint: ${sec}s → ${delay}ms delay`, "chatTurn");
      return delay;
    }
  }

  logger.info(
    `No retry hint found in error; using default ${DEFAULT_RETRY_DELAY_MS}ms`,
    "chatTurn",
  );
  return DEFAULT_RETRY_DELAY_MS;
}

/**
 * Converts our internal ChatTurnMessage array to the Gemini SDK history
 * format (role "model" instead of "assistant", parts array).
 *
 * Why: The Gemini SDK uses role="model" for assistant turns, while our
 * internal representation and the HTTP API use role="assistant".
 *
 * @param messages  Conversation history (all turns except the last user turn).
 * @returns         Gemini-compatible history array.
 */
function toGeminiHistory(
  messages: ChatTurnMessage[],
): { role: "user" | "model"; parts: { text: string }[] }[] {
  return messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));
}

// ---------------------------------------------------------------------------
// Request parser
// ---------------------------------------------------------------------------

/**
 * Parses and validates the raw Express request body for POST /v1/chat.
 *
 * Validates:
 *  - body is a non-null object.
 *  - messages is a non-empty array of { role, content } objects.
 *  - Each role is "user" or "assistant" and content is a non-empty string.
 *
 * Does NOT validate workflowDraft shape here — that is the job of
 * validateWorkflowDraft() in workflowValidator.ts.
 *
 * @param body  The raw request body from Express (req.body).
 * @returns     Typed { messages, workflowDraft }.
 * @throws      Error with a descriptive message on any validation failure.
 */
export function parseChatRequestBody(body: unknown): {
  messages: ChatTurnMessage[];
  workflowDraft: unknown;
} {
  logger.info("Parsing chat request body", "chatTurn");

  if (!body || typeof body !== "object") {
    throw new Error("Request body must be an object");
  }

  const rec = body as Record<string, unknown>;
  const messagesRaw = rec.messages;

  if (!Array.isArray(messagesRaw)) {
    throw new Error("messages must be an array");
  }

  const messages: ChatTurnMessage[] = [];

  for (const item of messagesRaw) {
    if (!item || typeof item !== "object") {
      throw new Error("Each message must be an object");
    }
    const m = item as Record<string, unknown>;
    const role = m.role;
    const content = m.content;

    if (role !== "user" && role !== "assistant") {
      throw new Error('message.role must be "user" or "assistant"');
    }
    if (typeof content !== "string") {
      throw new Error("message.content must be a string");
    }

    messages.push({ role, content });
  }

  logger.info(`Request body parsed: ${messages.length} message(s)`, "chatTurn");
  return { messages, workflowDraft: rec.workflowDraft };
}

// ---------------------------------------------------------------------------
// Core chat turn runner
// ---------------------------------------------------------------------------

/**
 * Executes a single chat turn: validates the draft, calls Gemini, parses
 * the structured response, and returns the typed AssistantTurnResponse.
 *
 * Retry behaviour:
 *  - Up to MAX_LLM_RETRY_ATTEMPTS attempts total.
 *  - Retries only on Gemini rate-limit (429 / RESOURCE_EXHAUSTED) errors.
 *  - Back-off delay is parsed from the Gemini error hint when available.
 *  - Non-retryable errors (parse failures, invalid schema, etc.) are re-thrown
 *    immediately on first occurrence.
 *
 * Finalize behaviour:
 *  - When the model sets phase="finalize" AND the draft passes Zod validation,
 *    the current workflowDraft is attached as finalizedJson on the turn.
 *  - If validation fails but the model still sets phase="finalize", the turn
 *    is returned without finalizedJson (the UI will not show the export block).
 *
 * @param input  The validated messages array and current workflow draft.
 * @returns      The normalised assistant turn response.
 * @throws       Error when Gemini is not configured or the LLM call fails.
 */
export async function runChatTurn(input: {
  messages: ChatTurnMessage[];
  workflowDraft: unknown;
}): Promise<AssistantTurnResponse> {
  logger.info(
    `Starting chat turn with ${input.messages.length} message(s)`,
    "chatTurn",
  );

  // Guard: Gemini client must be configured.
  const genAI = getGeminiClient();
  if (!genAI) {
    throw new Error("GEMINI_API_KEY is not set");
  }

  const msgs = input.messages;

  // Validate the message array shape and limits.
  if (!Array.isArray(msgs) || msgs.length === 0) {
    throw new Error("messages must be a non-empty array");
  }
  if (msgs.length > MAX_MESSAGES) {
    throw new Error(`At most ${MAX_MESSAGES} messages per request`);
  }

  const last = msgs[msgs.length - 1];
  if (!last || last.role !== "user") {
    throw new Error("Last message must be from the user");
  }

  // Validate all messages individually.
  for (const m of msgs) {
    if (m.role !== "user" && m.role !== "assistant") {
      throw new Error("Invalid message role");
    }
    if (typeof m.content !== "string" || !m.content.trim()) {
      throw new Error("Each message must have non-empty string content");
    }
    if (m.content.length > MAX_CONTENT_LENGTH) {
      throw new Error(`Message exceeds ${MAX_CONTENT_LENGTH} characters`);
    }
  }

  // Run Zod + semantic validation on the draft BEFORE building the system
  // instruction.  Errors are injected into the prompt so the model knows
  // which issues to guide the user through.
  const validation = validateWorkflowDraft(input.workflowDraft);
  const validationErrors = validation.ok ? undefined : validation.errors;

  if (validationErrors) {
    logger.warn(
      `Draft has ${validationErrors.length} validation error(s) — injecting into prompt`,
      "chatTurn",
    );
  }

  // Build the system instruction with the current draft and any errors.
  const modelName = getGeminiModelName();
  const model = genAI.getGenerativeModel({
    model: modelName,
    systemInstruction: buildSystemInstruction(input.workflowDraft, validationErrors),
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: assistantTurnSchema(),
    },
  });

  // All messages except the last are history; the last is the new user turn.
  const prior = msgs.slice(0, -1);
  const history = toGeminiHistory(prior);
  const chat = model.startChat({ history });
  const userText = last.content.trim();

  logger.info(
    `Sending to Gemini: model="${modelName}" historyLen=${prior.length}`,
    "chatTurn",
  );

  // Retry loop — handles rate-limit errors with back-off.
  let lastErr: unknown;

  for (let attempt = 0; attempt < MAX_LLM_RETRY_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      logger.info(`Retry attempt ${attempt + 1}/${MAX_LLM_RETRY_ATTEMPTS}`, "chatTurn");
    }

    try {
      const result = await chat.sendMessage(userText);
      const raw = result.response.text();

      if (!raw?.trim()) {
        throw new Error("Model returned an empty reply");
      }

      logger.info(`Gemini responded (${raw.length} chars raw)`, "chatTurn");

      // Parse and normalise the model's structured JSON output.
      const turn = parseAssistantTurnFromModelJson(raw.trim());

      // Attach finalizedJson only when:
      //  a) The model requested the finalize phase, AND
      //  b) The draft passed all Zod + semantic validation checks.
      // This ensures we never export an invalid or incomplete workflow.
      if (turn.phase === "finalize") {
        if (validation.ok) {
          turn.finalizedJson = input.workflowDraft as Record<string, unknown>;
          logger.info("Phase=finalize with valid draft — finalizedJson attached", "chatTurn");
        } else {
          logger.warn(
            "Model requested finalize but draft has validation errors — finalizedJson NOT attached",
            "chatTurn",
          );
        }
      }

      logger.info(
        `Chat turn complete: phase="${turn.phase}" widget="${turn.widget?.kind ?? "none"}"`,
        "chatTurn",
      );

      return turn;
    } catch (e) {
      lastErr = e;

      const isRateLimit = isGeminiRateLimitError(e);
      const canRetry = isRateLimit && attempt < MAX_LLM_RETRY_ATTEMPTS - 1;

      if (!canRetry) {
        logger.error(
          `Gemini call failed (attempt ${attempt + 1}) — not retrying`,
          "chatTurn",
          e,
        );
        throw e;
      }

      const delayMs = parseRetryDelayMs(e);
      logger.warn(
        `Rate-limited by Gemini (attempt ${attempt + 1}) — retrying in ${delayMs}ms`,
        "chatTurn",
      );

      await sleep(delayMs);
    }
  }

  // Should never reach here — the loop always returns or throws above.
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}