/**
 * @file utils/parseLimit.ts
 * @service pipedream-api
 * @description Utility for safely parsing and clamping pagination limit query params.
 *
 * Route handlers receive limits as raw query-string values (strings) or
 * occasionally numbers.  This helper centralises the parse-and-clamp logic so
 * every route applies the same rules and there is no duplication.
 */

/**
 * Parses a raw pagination `limit` value (string or number) into a safe integer.
 *
 * How it works:
 *  1. Converts the input to a number (parseInt for strings, Number() otherwise).
 *  2. Falls back to `fallback` when the result is non-finite or less than 1.
 *  3. Clamps the result to `max` so callers cannot request arbitrarily large pages.
 *
 * Why: Query-string values are always strings in Express.  Centralising this
 * prevents every route from independently guarding against NaN, zero, negatives,
 * and values that exceed the Pipedream SDK's pagination caps.
 *
 * @param raw       The raw query parameter value (any type accepted).
 * @param fallback  Value to use when parsing fails or the result is < 1.
 * @param max       Hard upper bound on the returned value.
 * @returns         An integer in the range [1, max].
 */
export function parseLimit(raw: unknown, fallback: number, max: number): number {
  const n = typeof raw === "string" ? Number.parseInt(raw, 10) : Number(raw);

  // Guard: parseInt/Number can return NaN or Infinity for bad inputs.
  if (!Number.isFinite(n) || n < 1) {
    return fallback;
  }

  return Math.min(n, max);
}