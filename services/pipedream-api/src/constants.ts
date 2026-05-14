/**
 * @file constants.ts
 * @service pipedream-api
 * @description Centralised compile-time constants for the pipedream-api service.
 *
 * Keeping every magic number and default string here means:
 *  - They are easy to audit and change in one place.
 *  - Route handlers stay free of unexplained literals.
 *  - Future environment-variable overrides have a documented fallback.
 */

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

/** Default TCP port the Express server binds to when PIPEDREAM_API_PORT is unset. */
export const DEFAULT_PIPEDREAM_API_PORT = 3001;

/** Fallback CORS-allowed web origin when WEB_ORIGIN env var is absent. */
export const DEFAULT_WEB_ORIGIN = "http://localhost:5173";

/** Maximum request body size accepted by Express JSON middleware. */
export const REQUEST_BODY_LIMIT = "1mb";

// ---------------------------------------------------------------------------
// Pagination helpers
// ---------------------------------------------------------------------------

/** Default number of app records returned by /v1/apps when limit is not specified. */
export const DEFAULT_APP_LIST_LIMIT = 25;

/** Maximum number of app records allowed per /v1/apps request. */
export const MAX_APP_LIST_LIMIT = 100;

/** Default number of connected accounts returned by /v1/accounts. */
export const DEFAULT_ACCOUNT_LIST_LIMIT = 50;

/** Maximum number of connected accounts per /v1/accounts request. */
export const MAX_ACCOUNT_LIST_LIMIT = 100;

/** Default number of action/trigger records per catalog search request. */
export const DEFAULT_COMPONENT_LIST_LIMIT = 25;

/** Maximum number of action/trigger records per catalog search request. */
export const MAX_COMPONENT_LIST_LIMIT = 100;

// ---------------------------------------------------------------------------
// Component resolution (resolveComponent)
// ---------------------------------------------------------------------------

/**
 * Maximum number of fuzzy-matched candidate components to retrieve via
 * Pipedream's API before giving up.  Limits outbound API calls in the
 * catalog-search fallback path.
 */
export const COMPONENT_RESOLVE_MAX_CANDIDATES = 24;

/**
 * Number of results per catalog-search query issued during fuzzy resolution.
 * A higher value improves recall at the cost of more API round-trips.
 */
export const CATALOG_SEARCH_LIMIT = 75;

/**
 * Minimum token length used when tokenising a component key for scoring.
 * Tokens shorter than this are discarded as noise (e.g. "to", "in").
 */
export const CATALOG_TOKEN_MIN_LENGTH = 3;