/**
 * A minimal Result type, so translation failures are values the caller must
 * handle rather than exceptions escaping a batch job. Shared by the engine
 * and platform adapters.
 */
export type Result<T, E = Error> = { ok: true; value: T } | { ok: false; error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}
