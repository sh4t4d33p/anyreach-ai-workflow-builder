/**
 * @file constants.ts
 * @service chat-api
 * @description Centralised compile-time constants for the chat-api service.
 *
 * Keeping every magic number and string here means:
 *  - They are easy to audit and change in one place.
 *  - Business-logic files stay free of unexplained literals.
 *  - Future environment-variable overrides have a documented fallback.
 */

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

/** Default TCP port the Express server binds to when CHAT_API_PORT is not set. */
export const DEFAULT_CHAT_API_PORT = 3002;

/** Fallback CORS-allowed web origin when WEB_ORIGIN env var is absent. */
export const DEFAULT_WEB_ORIGIN = "http://localhost:5173";

/** Maximum request body size accepted by Express JSON middleware. */
export const REQUEST_BODY_LIMIT = "1mb";

// ---------------------------------------------------------------------------
// Chat turn limits
// ---------------------------------------------------------------------------

/**
 * Maximum number of chat messages accepted per /v1/chat request.
 * Prevents runaway history from exhausting the Gemini context window.
 */
export const MAX_MESSAGES = 48;

/**
 * Maximum character length for any single chat message.
 * Aligned with the Gemini input token budget (~6 000 tokens ≈ 24 000 chars).
 */
export const MAX_CONTENT_LENGTH = 24_000;

// ---------------------------------------------------------------------------
// Prompt / draft
// ---------------------------------------------------------------------------

/**
 * Maximum characters of serialised workflow-draft JSON included in the
 * system instruction each turn.  Longer drafts are truncated with a trailing
 * notice so the model context window is not exceeded.
 */
export const MAX_DRAFT_JSON_LENGTH = 20_000;

// ---------------------------------------------------------------------------
// Gemini model
// ---------------------------------------------------------------------------

/** Default Gemini model identifier used when GEMINI_MODEL env var is unset. */
export const GEMINI_DEFAULT_MODEL = "gemini-2.5-flash";

// ---------------------------------------------------------------------------
// LLM retry (rate-limit back-off)
// ---------------------------------------------------------------------------

/**
 * Maximum number of attempts for a single LLM call.
 * On 429 / RESOURCE_EXHAUSTED the call is retried up to this many times.
 */
export const MAX_LLM_RETRY_ATTEMPTS = 4;

/**
 * Fallback retry delay in milliseconds when Gemini does not include a
 * "retry in Xs" hint in the error message.
 */
export const DEFAULT_RETRY_DELAY_MS = 3_500;

/**
 * Hard upper bound on the computed retry delay so a malformed Gemini hint
 * cannot stall the server for minutes.
 */
export const MAX_RETRY_DELAY_MS = 120_000;