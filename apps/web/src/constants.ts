/**
 * @file constants.ts
 * @app web
 * @description Centralised compile-time constants for the web application.
 *
 * Keeping these values here:
 *  - Prevents magic numbers from being scattered across components.
 *  - Makes product-level tuning (debounce durations, limits) easy to find.
 *  - Provides a single source of truth for values shared across components.
 */

// ---------------------------------------------------------------------------
// Chat input
// ---------------------------------------------------------------------------

/**
 * Maximum character length the user can type in the chat textarea.
 * Enforced both by the HTML maxLength attribute and by the send handler
 * to match the server-side MAX_CONTENT_LENGTH limit.
 */
export const MAX_CHAT_INPUT_LENGTH = 8_000;

// ---------------------------------------------------------------------------
// App picker widget
// ---------------------------------------------------------------------------

/** Number of app results fetched per search query in the AppPickerWidget. */
export const APP_PICKER_FETCH_LIMIT = 20;

/**
 * Debounce delay (ms) before firing an app search after the user stops typing.
 * Balances responsiveness against unnecessary API calls.
 */
export const APP_PICKER_DEBOUNCE_MS = 280;

// ---------------------------------------------------------------------------
// Field config widget — remote options
// ---------------------------------------------------------------------------

/**
 * Debounce delay (ms) before firing a configure-prop call after the user
 * changes a filter or dependent field.  Slightly longer than the app picker
 * to reduce Pipedream API load on cascading dependent fields.
 */
export const REMOTE_OPTIONS_DEBOUNCE_MS = 350;