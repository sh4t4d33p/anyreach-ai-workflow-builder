/**
 * @file logger.ts
 * @service pipedream-api
 * @description Minimal structured logger for the pipedream-api service.
 *
 * All lines are prefixed with "[pipedream-api]" for easy grepping when
 * both services run concurrently in the same terminal.
 *
 * Why a wrapper instead of bare console.*?
 *  - Consistent prefix across every file without repetition.
 *  - Optional component label allows filtering by route or subsystem.
 *  - Single place to adopt a structured logger (pino, winston) later.
 */

const SERVICE = "pipedream-api";

/**
 * Builds the bracketed log prefix.
 *
 * @param level      Severity: INFO | WARN | ERROR.
 * @param component  Optional sub-system label (e.g. "connectRoutes", "resolver").
 * @returns          String like "[pipedream-api][connectRoutes][INFO]".
 */
function buildPrefix(level: "INFO" | "WARN" | "ERROR", component?: string): string {
  return component
    ? `[${SERVICE}][${component}][${level}]`
    : `[${SERVICE}][${level}]`;
}

export const logger = {
  /**
   * General informational messages — server startup, request lifecycle,
   * successful resolution, happy-path events.
   *
   * @param msg        Human-readable message.
   * @param component  Optional sub-system label for filtering.
   * @param meta       Any additional structured context.
   */
  info(msg: string, component?: string, ...meta: unknown[]): void {
    console.log(buildPrefix("INFO", component), msg, ...meta);
  },

  /**
   * Non-fatal warnings — recoverable errors, degraded-mode operation,
   * unexpected-but-handled states (e.g. component not found in catalog).
   *
   * @param msg        Human-readable warning message.
   * @param component  Optional sub-system label.
   * @param meta       Additional context.
   */
  warn(msg: string, component?: string, ...meta: unknown[]): void {
    console.warn(buildPrefix("WARN", component), msg, ...meta);
  },

  /**
   * Fatal or request-failing errors.  The raw error object is always logged
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