import type { Config, ConfigKey } from './schema';

/**
 * Hand-rolled replacement for the `zod`-based `configSchema` (round-5 bloat
 * audit). Measured directly: `zod` was 51% of the shipped extension's bytes
 * (202KB of a 393KB build) and landed THREE separate times — once each in
 * `content-scripts/content.js`, `background.js`, and the options page's own
 * chunk — because content scripts can't share a chunk with the background
 * graph. Combined with the content script's `allFrames: true`
 * (`entrypoints/content.ts`), that meant ~67KB of validation-library code was
 * parsed in every iframe of every page visited, to do exactly three things:
 * validate one stored value's type on load (`configStore.ts`'s `initConfig`),
 * validate a whole partial object on import/restore
 * (`configStore.ts`'s `applyValidatedConfig`), and the same on a settings-file
 * import (`backup.ts`'s `parseBackup`). 23 flat keys — strings, booleans,
 * string arrays, two enums, two string-keyed records, one small nullable
 * object — need none of zod's transforms, coercion, defaults, or refinements.
 *
 * This file is deliberately just a validator table, not a schema-builder
 * abstraction: no generic combinator library, because there's nothing here
 * generic enough to warrant one. `configValidators` below is typed as
 * `{ [K in ConfigKey]: Validator<Config[K]> }` — a mapped type over the SAME
 * `Config` interface `schema.ts` hand-writes now that it's no longer derived
 * via `z.infer`. That mapped type is what keeps the two files honest: adding
 * a field to `Config` without adding its validator here is a compile error,
 * the same static coupling `z.infer` used to give for free.
 *
 * Two zod behaviors preserved deliberately, not by accident, because real
 * call sites depend on them:
 *   1. Unknown keys are silently dropped, never rejected — a settings file
 *      exported by a newer build must still import cleanly on an older one.
 *      `validatePartialConfig` builds its result by iterating
 *      `configValidators`, never the input object, so this falls out
 *      naturally rather than needing an explicit "delete extra keys" step.
 *   2. `bubblePosition`'s inner object also strips unknown keys, and the
 *      whole value stays nullable.
 */

export interface ValidationOk<T> {
  ok: true;
  value: T;
}

export interface ValidationErr {
  ok: false;
  message: string;
}

export type ValidationResult<T> = ValidationOk<T> | ValidationErr;

export type Validator<T> = (value: unknown) => ValidationResult<T>;

function ok<T>(value: T): ValidationOk<T> {
  return { ok: true, value };
}

function fail(message: string): ValidationErr {
  return { ok: false, message };
}

/** A plain, non-array, non-null object — the shape `recordOf`/`nullableObject` operate on. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export const str: Validator<string> = (v) => (typeof v === 'string' ? ok(v) : fail('expected a string'));

export const bool: Validator<boolean> = (v) => (typeof v === 'boolean' ? ok(v) : fail('expected a boolean'));

export const num: Validator<number> = (v) =>
  typeof v === 'number' && Number.isFinite(v) ? ok(v) : fail('expected a number');

export const strArray: Validator<string[]> = (v) => {
  if (!Array.isArray(v)) return fail('expected an array of strings');
  const values: string[] = [];
  for (const item of v) {
    if (typeof item !== 'string') return fail('expected an array of strings');
    values.push(item);
  }
  return ok(values);
};

export function enumOf<T extends string>(...allowed: T[]): Validator<T> {
  return (v) =>
    typeof v === 'string' && (allowed as string[]).includes(v)
      ? ok(v as T)
      : fail(`expected one of ${allowed.join(', ')}`);
}

/** A string-keyed record whose values each pass `valueValidator`. Unknown-shaped entries fail the whole record — there's no per-entry drop here, unlike the top-level partial-config behavior, since a corrupt record means a corrupt object, not "an extra field." */
export function recordOf<T>(valueValidator: Validator<T>): Validator<Record<string, T>> {
  return (v) => {
    if (!isPlainObject(v)) return fail('expected an object');
    const result: Record<string, T> = {};
    for (const [key, raw] of Object.entries(v)) {
      const validated = valueValidator(raw);
      if (!validated.ok) return fail(`"${key}": ${validated.message}`);
      result[key] = validated.value;
    }
    return ok(result);
  };
}

/** An object with exactly the given known keys, each validated; unknown keys are dropped, not rejected (same rationale as the top-level partial-config behavior — see this file's header comment). The whole value may also be `null`. */
export function nullableObject<S extends Record<string, unknown>>(
  shape: {
    [K in keyof S]: Validator<S[K]>;
  },
): Validator<S | null> {
  return (v) => {
    if (v === null) return ok(null);
    if (!isPlainObject(v)) return fail('expected an object or null');
    const result = {} as S;
    for (const key of Object.keys(shape) as (keyof S)[]) {
      const validated = shape[key](v[key as string]);
      if (!validated.ok) return fail(`"${String(key)}": ${validated.message}`);
      result[key] = validated.value;
    }
    return ok(result);
  };
}

/**
 * The direct replacement for `configSchema.shape` — one validator per config
 * key, used by `configStore.ts`'s `initConfig` to check a single stored value
 * in isolation. The mapped type over `Config` (see header comment) is what
 * makes an added-but-unvalidated field a compile error.
 */
export const configValidators: { [K in ConfigKey]: Validator<Config[K]> } = {
  targetLanguage: str,
  sourceLanguage: str,
  pageTranslatorProvider: enumOf('google', 'googleCloudTranslate', 'llm'),
  googleCloudTranslateApiKey: str,
  llmBaseUrl: str,
  llmApiKey: str,
  llmModel: str,
  alwaysTranslateSites: strArray,
  neverTranslateSites: strArray,
  alwaysTranslateLangs: strArray,
  neverTranslateLangs: strArray,
  bubbleEnabled: bool,
  bubbleByHost: recordOf(bool),
  bubblePosition: nullableObject({ side: enumOf('left', 'right'), yFrac: num }),
  sourceLanguageByHost: recordOf(str),
  targetLanguages: strArray,
  hoverTooltipEnabled: bool,
  selectionPopupEnabled: bool,
  theme: enumOf('auto', 'light', 'dark'),
  translationCacheEnabled: bool,
  translatePreTags: bool,
  selectionPopupSkipInvalidText: bool,
  selectionPopupSkipTargetLanguageText: bool,
};

export interface PartialConfigOk {
  ok: true;
  value: Partial<Config>;
}

export interface PartialConfigErr {
  ok: false;
  path: string;
  message: string;
}

/**
 * The direct replacement for `configSchema.partial().safeParse(...)` —
 * validates whatever subset of `Config`'s keys are present on `input` (an
 * import/backup/restore payload), silently ignoring anything else on it.
 * Keys ABSENT from `input` are absent from the result too (not present with
 * an `undefined` value) — `configStore.ts`'s `applyValidatedConfig` and
 * `backup.ts`'s `parseBackup` both rely on iterating only the keys that were
 * actually supplied.
 */
export function validatePartialConfig(input: unknown): PartialConfigOk | PartialConfigErr {
  if (!isPlainObject(input)) return { ok: false, path: '', message: 'expected an object' };
  const value: Partial<Config> = {};
  for (const key of Object.keys(configValidators) as ConfigKey[]) {
    if (!Object.hasOwn(input, key)) continue;
    const validated = configValidators[key](input[key]);
    if (!validated.ok) return { ok: false, path: key, message: validated.message };
    (value as Record<ConfigKey, unknown>)[key] = validated.value;
  }
  return { ok: true, value };
}

/** Convenience used by callers that want the old `.parse()`-style "throw on failure" behavior instead of checking `.ok`. */
export function parsePartialConfigOrThrow(input: unknown): Partial<Config> {
  const result = validatePartialConfig(input);
  if (!result.ok) {
    throw new Error(result.path ? `config field "${result.path}": ${result.message}` : result.message);
  }
  return result.value;
}
