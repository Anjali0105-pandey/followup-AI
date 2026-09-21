import "server-only";

/**
 * Minimal server-side error logging.
 *
 * The app had none. Next replaces a thrown Server Action error with an opaque
 * digest before it reaches the browser, so a failure in production left no
 * trace anywhere: the rep saw "something went wrong" and the operator saw
 * nothing at all. This at least puts the message, the digest-able stack and a
 * scope label in the platform log.
 *
 * Deliberately not a logging framework — one function, so there is no excuse
 * for a swallowed error. Point it at a real sink (Sentry, Axiom, the Vercel
 * drain) when there is one.
 */
export function logError(scope: string, error: unknown, context?: Record<string, unknown>): void {
  const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
  // Never log a request body or a decrypted key: pass ids, not payloads.
  console.error(`[${scope}] ${detail}`, context ? JSON.stringify(context) : "");
}

/**
 * Wraps a server-side operation so a failure is recorded before it propagates.
 * Rethrows, so callers and error boundaries behave exactly as before.
 */
export async function logged<T>(scope: string, fn: () => Promise<T>, context?: Record<string, unknown>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    logError(scope, error, context);
    throw error;
  }
}
