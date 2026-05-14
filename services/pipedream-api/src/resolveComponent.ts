/**
 * @file resolveComponent.ts
 * @service pipedream-api
 * @description Fuzzy component-key resolution for LLM-generated Pipedream keys.
 *
 * Problem: The LLM generates component keys (e.g. "slack-send-message") from
 * its training data, but these keys can be wrong, outdated, or hallucinated
 * (e.g. "slack-new-saved-message" instead of "slack-send-message").
 *
 * Solution: A two-stage resolver:
 *  Stage 1 — Direct retrieve: Try the key as-is against Pipedream's retrieve
 *    endpoint.  If it exists, return it immediately (zero extra API calls).
 *  Stage 2 — Catalog fuzzy search: If retrieve fails (404), search the
 *    Pipedream public catalog for the specified app, score all candidates
 *    against the original key using token overlap, and retrieve the best
 *    match.  Stop at the first candidate that retrieve accepts.
 *
 * Scoring heuristic (scoreMatch):
 *  - Exact match: highest score (1 000 000).
 *  - Substring containment: high score (500 000).
 *  - Token overlap: sum of (token length × 10) for each token found in the
 *    candidate key.  Longer shared tokens score higher than shorter ones.
 *
 * Why not just use Pipedream search directly?
 *  The search endpoint returns many candidates.  Without scoring we would
 *  have to retrieve all of them — expensive.  Scoring lets us try the best
 *  candidate first and stop early on a hit.
 */

import type { PipedreamClient } from "@pipedream/sdk";
import { logger } from "./logger.js";
import {
  COMPONENT_RESOLVE_MAX_CANDIDATES,
  CATALOG_SEARCH_LIMIT,
  CATALOG_TOKEN_MIN_LENGTH,
} from "./constants.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Resolved component kind — either a trigger or an action. */
export type ResolvedKind = "trigger" | "action";

/**
 * Result of a successful component resolution.
 * matchedKey is the actual Pipedream key (may differ from the input hint).
 */
export type ResolveComponentResult = {
  matchedKey: string;
  kind: ResolvedKind;
  /** Full component definition from the Pipedream retrieve endpoint. */
  data: unknown;
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Attempts to retrieve a component by exact key from Pipedream.
 *
 * Why return null instead of throwing?
 *  A 404 from Pipedream means the key doesn't exist — that's an expected
 *  outcome for LLM-guessed keys, not an error.  We use null to signal
 *  "not found" so the caller can proceed to the fuzzy-search stage.
 *
 * @param pd    Pipedream SDK client.
 * @param key   Component key to retrieve.
 * @param kind  Whether to call triggers.retrieve or actions.retrieve.
 * @returns     The component data object, or null if not found / errored.
 */
async function tryRetrieve(
  pd: PipedreamClient,
  key: string,
  kind: ResolvedKind,
): Promise<unknown | null> {
  try {
    if (kind === "trigger") {
      const r = await pd.triggers.retrieve(key, {});
      return r.data;
    }
    const r = await pd.actions.retrieve(key, {});
    return r.data;
  } catch {
    // Any error (404, network, etc.) is treated as "not found" in this context.
    return null;
  }
}

/**
 * Tokenises a component key string into meaningful word fragments.
 *
 * How: Splits on non-alphanumeric characters, lowercases, and discards
 * tokens shorter than CATALOG_TOKEN_MIN_LENGTH (avoids noise like "to", "in").
 *
 * Example: "google_sheets-new-spreadsheet-row" → ["google", "sheets", "new", "spreadsheet", "row"]
 *
 * @param s  The string to tokenise.
 * @returns  Array of lowercase tokens of meaningful length.
 */
function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter((w) => w.length >= CATALOG_TOKEN_MIN_LENGTH);
}

/**
 * Scores how well a candidate component key matches the input hint key.
 *
 * Scoring tiers (descending):
 *  1. Exact match (after normalising _ to -): 1 000 000.
 *  2. One contains the other: 500 000.
 *  3. Token overlap: sum of (token.length × 10) for shared tokens.
 *     Longer tokens score higher — "spreadsheet" beats "new".
 *
 * @param hintKey       The original LLM-generated key.
 * @param candidateKey  A key from the Pipedream catalog.
 * @returns             Numeric score — higher is a better match.
 */
function scoreMatch(hintKey: string, candidateKey: string): number {
  const h = hintKey.toLowerCase().replace(/_/g, "-");
  const c = candidateKey.toLowerCase().replace(/_/g, "-");

  if (h === c) return 1_000_000;
  if (c.includes(h) || h.includes(c)) return 500_000;

  const ht = tokenize(hintKey);
  const ck = candidateKey.toLowerCase();
  let sc = 0;

  for (const t of ht) {
    if (ck.includes(t)) sc += t.length * 10;
  }

  return sc;
}

/**
 * Builds a list of search query strings to use when querying the Pipedream
 * catalog for matching components.
 *
 * Generates multiple queries from a single hint key to maximise recall:
 *  - Full key with hyphens/underscores replaced by spaces.
 *  - App-stripped suffix (e.g. "send-message" for "slack-send-message").
 *  - Last dash-separated segment (e.g. "message").
 *
 * Deduplicates and removes empty strings before returning.
 *
 * @param hintKey  The original component key hint.
 * @param app      Optional app slug to strip from the front of the key.
 * @returns        Deduplicated list of search query strings.
 */
function searchQueries(hintKey: string, app?: string): string[] {
  const out: string[] = [];
  const trimmed = hintKey.trim();
  if (!trimmed) return out;

  // Full key with separators replaced by spaces.
  out.push(trimmed.replace(/[_-]+/g, " ").trim());

  // Strip the app prefix to get the action-specific part.
  const dashParts = trimmed.split("-");
  if (dashParts.length >= 2 && app && dashParts[0] === app) {
    out.push(dashParts.slice(1).join(" ").replace(/_/g, " ").trim());
  }

  // Last segment only (often the most distinctive word).
  const last = dashParts[dashParts.length - 1];
  if (last) out.push(last.replace(/_/g, " ").trim());

  return [...new Set(out.filter(Boolean))];
}

/**
 * Collects all component keys matching the given queries from the Pipedream
 * catalog for a specific app and kind.
 *
 * Runs multiple search queries and merges the results into a deduplicated
 * set.  An undefined query (the first entry) fetches the unfiltered list for
 * the app, giving a baseline set of candidates.
 *
 * @param pd       Pipedream SDK client.
 * @param app      App slug to scope the catalog search.
 * @param kind     Whether to search triggers or actions.
 * @param queries  Array of search query strings (undefined = unfiltered).
 * @returns        Deduplicated array of component key strings.
 */
async function collectCatalogKeys(
  pd: PipedreamClient,
  app: string,
  kind: ResolvedKind,
  queries: (string | undefined)[],
): Promise<string[]> {
  const keys = new Set<string>();

  for (const q of queries) {
    logger.info(
      `Catalog search: app="${app}" kind="${kind}" q="${q ?? "<unfiltered>"}"`,
      "resolver",
    );

    const page =
      kind === "trigger"
        ? await pd.triggers.list({ app, q, limit: CATALOG_SEARCH_LIMIT, registry: "public" })
        : await pd.actions.list({ app, q, limit: CATALOG_SEARCH_LIMIT, registry: "public" });

    for (const c of page.data) keys.add(c.key);
  }

  return [...keys];
}

// ---------------------------------------------------------------------------
// Public resolver
// ---------------------------------------------------------------------------

/**
 * Resolves a possibly-wrong LLM component key hint to a real Pipedream key.
 *
 * Stage 1 — Direct retrieve:
 *  Try the key as-is.  For "auto" kind, try trigger first then action.
 *  Returns immediately on the first hit (no catalog call needed).
 *
 * Stage 2 — Fuzzy catalog search (only when stage 1 fails and app is known):
 *  1. Generate search queries from the hint key.
 *  2. Collect all candidate keys from the catalog.
 *  3. Score each candidate with scoreMatch().
 *  4. Retrieve candidates in descending score order.
 *  5. Stop at the first successful retrieve (hit).
 *  6. Give up after COMPONENT_RESOLVE_MAX_CANDIDATES attempts.
 *
 * Returns null when no match is found in either stage.
 *
 * @param pd      Pipedream SDK client.
 * @param params  { key: hint, app?: slug, kind: "trigger"|"action"|"auto" }
 * @returns       ResolveComponentResult on success, null on failure.
 */
export async function resolveComponent(
  pd: PipedreamClient,
  params: {
    key: string;
    app?: string;
    kind: "trigger" | "action" | "auto";
  },
): Promise<ResolveComponentResult | null> {
  const trimmed = params.key.trim();
  if (!trimmed) {
    logger.warn("resolveComponent called with empty key", "resolver");
    return null;
  }

  logger.info(
    `resolveComponent: key="${trimmed}" app="${params.app ?? ""}" kind="${params.kind}"`,
    "resolver",
  );

  // Determine the order of kinds to try for direct retrieve.
  const tryOrder: ResolvedKind[] =
    params.kind === "trigger"
      ? ["trigger"]
      : params.kind === "action"
        ? ["action"]
        : ["trigger", "action"];

  // Stage 1: Try direct retrieve with the exact key.
  for (const k of tryOrder) {
    logger.info(`Stage 1: trying direct retrieve as ${k} for key="${trimmed}"`, "resolver");
    const data = await tryRetrieve(pd, trimmed, k);

    if (data) {
      logger.info(`Stage 1 hit: key="${trimmed}" kind="${k}"`, "resolver");
      return { matchedKey: trimmed, kind: k, data };
    }
  }

  logger.info(`Stage 1 miss — no direct match for key="${trimmed}"`, "resolver");

  // Stage 2 requires an app slug to scope the catalog search.
  const app = params.app?.trim();
  if (!app) {
    logger.warn(
      `Stage 2 skipped: no app slug provided for key="${trimmed}"`,
      "resolver",
    );
    return null;
  }

  // Determine which kinds to search in the catalog.
  const listKinds: ResolvedKind[] =
    params.kind === "auto"
      ? ["trigger", "action"]
      : params.kind === "trigger"
        ? ["trigger"]
        : ["action"];

  // Build search queries: undefined = unfiltered list, plus keyword queries.
  const queries = searchQueries(trimmed, app);
  const querySet: (string | undefined)[] = [undefined, ...queries];

  logger.info(
    `Stage 2: catalog search for app="${app}" kinds=${listKinds.join(",")} queries=${JSON.stringify(querySet)}`,
    "resolver",
  );

  // Collect and score all candidate keys from the catalog.
  const ranked: { key: string; kind: ResolvedKind; score: number }[] = [];

  for (const lk of listKinds) {
    const keys = await collectCatalogKeys(pd, app, lk, querySet);

    for (const cand of keys) {
      ranked.push({ key: cand, kind: lk, score: scoreMatch(trimmed, cand) });
    }
  }

  // Sort descending by score so we try the most likely match first.
  ranked.sort((a, b) => b.score - a.score);

  logger.info(
    `Stage 2: ${ranked.length} candidate(s) collected, trying top ${COMPONENT_RESOLVE_MAX_CANDIDATES}`,
    "resolver",
  );

  // Retrieve candidates in score order until one succeeds.
  const seen = new Set<string>();
  let attempts = 0;

  for (const row of ranked) {
    if (row.score <= 0) continue;

    // Deduplicate (same key can appear from multiple queries).
    const dedupe = `${row.kind}:${row.key}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);

    if (attempts >= COMPONENT_RESOLVE_MAX_CANDIDATES) {
      logger.warn(
        `Stage 2: reached max candidate attempts (${COMPONENT_RESOLVE_MAX_CANDIDATES}) — giving up`,
        "resolver",
      );
      break;
    }
    attempts += 1;

    logger.info(
      `Stage 2 attempt ${attempts}: trying "${row.key}" (${row.kind}) score=${row.score}`,
      "resolver",
    );

    const data = await tryRetrieve(pd, row.key, row.kind);
    if (data) {
      logger.info(
        `Stage 2 hit: "${trimmed}" → "${row.key}" (${row.kind}) after ${attempts} attempt(s)`,
        "resolver",
      );
      return { matchedKey: row.key, kind: row.kind, data };
    }
  }

  logger.warn(
    `resolveComponent: could not resolve key="${trimmed}" after all attempts`,
    "resolver",
  );
  return null;
}
