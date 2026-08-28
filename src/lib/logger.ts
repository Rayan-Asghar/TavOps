/**
 * Structured logging.
 *
 * There was previously not one log statement in the application, so a sync
 * failure at 3am left nothing behind but a `last_error` column nobody queries.
 * This writes single-line JSON to stdout, which is what every hosted log drain
 * expects and what `docker logs | jq` reads without help.
 *
 * Deliberately dependency-free: a logging library is a supply-chain dependency
 * and a config file in exchange for `JSON.stringify`.
 */

type Level = "debug" | "info" | "warn" | "error";

/** Anything JSON-serialisable. Errors are unwrapped by `serialise` below. */
export type LogContext = Record<string, unknown>;

const LEVEL_ORDER: Record<Level, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

/** LOG_LEVEL trims noise in production without a redeploy. */
function threshold(): number {
  const configured = (process.env.LOG_LEVEL ?? "info").toLowerCase();
  return LEVEL_ORDER[configured as Level] ?? LEVEL_ORDER.info;
}

/**
 * Errors do not survive JSON.stringify — `{}` is what you get — so they are
 * unwrapped by hand wherever they appear in the context.
 */
function serialise(value: unknown): unknown {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
      ...(value.cause ? { cause: serialise(value.cause) } : {}),
    };
  }
  return value;
}

function emit(level: Level, event: string, context: LogContext = {}) {
  if (LEVEL_ORDER[level] < threshold()) return;

  const payload: Record<string, unknown> = {
    level,
    event,
    at: new Date().toISOString(),
  };
  for (const [key, value] of Object.entries(context)) {
    payload[key] = serialise(value);
  }

  // Errors and warnings to stderr so they survive a stdout-only pipe.
  const line = JSON.stringify(payload);
  if (level === "error" || level === "warn") process.stderr.write(line + "\n");
  else process.stdout.write(line + "\n");
}

export const log = {
  debug: (event: string, context?: LogContext) => emit("debug", event, context),
  info: (event: string, context?: LogContext) => emit("info", event, context),
  warn: (event: string, context?: LogContext) => emit("warn", event, context),
  error: (event: string, context?: LogContext) => emit("error", event, context),
};

/**
 * A short id tying a user-facing error message to its log line.
 *
 * Server Components deliberately hide error detail from the browser, so
 * without a shared handle "something went wrong" is unmatchable against the
 * logs. Not a security boundary — just a correlation handle.
 */
export function newRequestId(): string {
  return Math.random().toString(36).slice(2, 10);
}
