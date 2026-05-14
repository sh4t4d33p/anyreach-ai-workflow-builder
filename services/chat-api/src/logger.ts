/**
 * @file logger.ts
 * @service chat-api
 * @description Minimal structured logger for the chat-api service.
 *
 * All log lines are prefixed with "[chat-api]" so they are easy to grep in
 * multiplexed terminal output (e.g. when running both services concurrently).
 *
 * Why a thin wrapper instead of bare console.*?
 *  - Consistent prefix and format across every file without repetition.
 *  - Optional component label enables filtering by subsystem.
 *  - Single place to swap in a structured logger (pino, winston) later.
 *  - Allows log-level silencing in tests without monkey-patching console.
 */

const SERVICE = "chat-api";

/**
 * Builds the bracketed log prefix.
 *
 * @param level      Severity: INFO | WARN | ERROR.
 * @param component  Optional sub-system label (e.g. "chatTurn", "validator").
 * @returns          String like "[chat-api][chatTurn][INFO]".
 */
function buildPrefix(level: "INFO" | "WARN" | "ERROR", component?: string): string {
  return component
    ? `[${SERVICE}][${component}][${level}]`
    : `[${SERVICE}][${level}]`;
}

export const logger = {
  /**
   * General informational messages — server startup, request lifecycle,
   * happy-path flow, timing.
   *
   * @param msg        Human-readable message.
   * @param component  Optional sub-system label for filtering.
   * @param meta       Any additional structured context (objects, numbers).
   */
  info(msg: string, component?: string, ...meta: unknown[]): void {
    console.log(buildPrefix("INFO", component), msg, ...meta);
  },

  /**
   * Non-fatal warnings — recoverable errors, unexpected-but-handled states,
   * truncated inputs, degraded-mode operation.
   *
   * @param msg        Human-readable warning message.
   * @param component  Optional sub-system label.
   * @param meta       Additional context.
   */
  warn(msg: string, component?: string, ...meta: unknown[]): void {
    console.warn(buildPrefix("WARN", component), msg, ...meta);
  },

  /**
   * Fatal or request-failing errors.  The raw error object is always printed
   * on a second line so stack traces are preserved.
   *
   * @param msg        Human-readable error summary.
   * @param component  Optional sub-system label.
   * @param err        The caught error or any additional context.
   */
  error(msg: string, component?: string, err?: unknown): void {
    console.error(buildPrefix("ERROR", component), msg);
    if (err !== undefined) {
      console.error(err);
    }
  },
};