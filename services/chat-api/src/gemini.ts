/**
 * @file gemini.ts
 * @service chat-api
 * @description Singleton factory for the Google Generative AI client and model
 * name resolution.
 *
 * Why a singleton?
 *  - The GoogleGenerativeAI constructor reads the API key at creation time.
 *    Constructing it once avoids re-reading process.env on every request.
 *  - A single instance is safe for concurrent requests (the SDK is stateless
 *    at the client level; per-request state lives in the chat session object).
 *
 * Why separate from chatTurn.ts?
 *  - chatTurn.ts is request-scoped logic; this file is configuration.
 *  - Keeping the client factory here means future routes can import it without
 *    creating a circular dependency through chatTurn.
 */

import { GoogleGenerativeAI } from "@google/generative-ai";
import { GEMINI_DEFAULT_MODEL } from "./constants.js";
import { logger } from "./logger.js";

/** Module-level singleton — initialised on first call to getGeminiClient(). */
let client: GoogleGenerativeAI | null = null;

/**
 * Returns the singleton Gemini client, creating it on first call.
 *
 * Returns null (rather than throwing) when the API key is absent so callers
 * can return a 503 with a helpful message instead of crashing the process.
 *
 * @returns The GoogleGenerativeAI instance, or null if GEMINI_API_KEY is unset.
 */
export function getGeminiClient(): GoogleGenerativeAI | null {
  const key = process.env.GEMINI_API_KEY?.trim();

  if (!key) {
    logger.warn("GEMINI_API_KEY is not set — Gemini client unavailable", "gemini");
    return null;
  }

  if (!client) {
    logger.info("Initialising Gemini client (first call)", "gemini");
    client = new GoogleGenerativeAI(key);
  }

  return client;
}

/**
 * Returns the Gemini model identifier to use for chat turns.
 *
 * Falls back to GEMINI_DEFAULT_MODEL from constants when the GEMINI_MODEL
 * environment variable is not set, so there is always a safe default.
 *
 * @returns Model name string (e.g. "gemini-2.5-flash").
 */
export function getGeminiModelName(): string {
  const model = (process.env.GEMINI_MODEL ?? GEMINI_DEFAULT_MODEL).trim();
  logger.info(`Using Gemini model: "${model}"`, "gemini");
  return model;
}