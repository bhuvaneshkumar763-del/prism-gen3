import { err, ok, type Result } from '../result';
import { type Config, configSchema } from './schema';

/**
 * Settings backup serialization for the options page's Export/Import —
 * the pre-rewrite fork's popup had this; Gen 3's `configStore.export()`/
 * `import()` (src/platform/configStore.ts) already existed and were
 * already tested, just never wired to any UI. This module is the pure
 * validation/formatting layer between that store API and the options page.
 */

export const BACKUP_FORMAT_VERSION = 1;

export interface BackupPayload {
  version: number;
  timestamp: number;
  config: Partial<Config>;
}

export function serializeBackup(config: Config, timestamp: number): string {
  const payload: BackupPayload = { version: BACKUP_FORMAT_VERSION, timestamp, config };
  return JSON.stringify(payload, null, 2);
}

/**
 * Accepts either this module's own `{version, timestamp, config}` shape or
 * a bare config object (the shape `configStore.export()` itself produces,
 * and what an older/simpler export tool might hand back) — returns a real
 * error message instead of throwing on malformed JSON or a config shape
 * that doesn't validate, so the options page can show the user what went
 * wrong rather than an unhandled exception.
 */
export function parseBackup(json: string): Result<Partial<Config>, string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    return err(`That file isn't valid JSON (${e instanceof Error ? e.message : String(e)}).`);
  }

  const isWrapped = parsed !== null && typeof parsed === 'object' && 'config' in (parsed as Record<string, unknown>);
  const configCandidate = isWrapped ? (parsed as { config: unknown }).config : parsed;

  // Same fallback migrations.ts applies to stored config (versions 3/4):
  // a backup exported before the `builtin`/`libretranslate` provider
  // removals still has one of those values here, and unlike the raw-storage
  // load path, nothing else remaps it before schema validation — without
  // this, restoring an old-but-otherwise-valid backup would fail the
  // `pageTranslatorProvider` enum check and reject the whole import.
  if (
    configCandidate !== null &&
    typeof configCandidate === 'object' &&
    'pageTranslatorProvider' in configCandidate &&
    ((configCandidate as Record<string, unknown>).pageTranslatorProvider === 'builtin' ||
      (configCandidate as Record<string, unknown>).pageTranslatorProvider === 'libretranslate')
  ) {
    (configCandidate as Record<string, unknown>).pageTranslatorProvider = 'google';
  }

  const result = configSchema.partial().safeParse(configCandidate);
  if (!result.success) {
    const issue = result.error.issues[0];
    return err(
      `That doesn't look like a Prism settings file${issue ? ` (${issue.path.join('.')}: ${issue.message})` : ''}.`,
    );
  }
  return ok(result.data);
}
