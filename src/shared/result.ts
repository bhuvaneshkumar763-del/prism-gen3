/**
 * A minimal Result type used across the engine so translation
 * failures (a provider error, a malformed response) are values the caller
 * must handle, not exceptions that can silently escape a batch job. Kept
 * here (not in src/engine/) because both the engine and platform adapters
 * need the same shape.
 */
export type Result<T, E = Error> = { ok: true; value: T } | { ok: false; error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

export function unwrapOr<T, E>(result: Result<T, E>, fallback: T): T {
  return result.ok ? result.value : fallback;
}
