import { err, ok, type Result } from '../result';
import type { Config } from './schema';
import { validatePartialConfig } from './validate';

/**
 * Settings backup serialization for the options page's Export/Import: the
 * pure validation/formatting layer over `configStore.export()`/`import()`.
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
 * Accepts this module's `{version, timestamp, config}` shape or a bare config
 * object (what `configStore.export()` produces). Returns an error message
 * instead of throwing, so the options page can show what went wrong.
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

  // Same fallback as migrations.ts v3-v5: an old backup naming a removed
  // provider would otherwise fail the enum check and reject the whole import.
  if (
    configCandidate !== null &&
    typeof configCandidate === 'object' &&
    'pageTranslatorProvider' in configCandidate &&
    ['builtin', 'libretranslate', 'llm'].includes(
      String((configCandidate as Record<string, unknown>).pageTranslatorProvider),
    )
  ) {
    (configCandidate as Record<string, unknown>).pageTranslatorProvider = 'google';
  }
  // The removed `llm` provider's fields (one is an API key) aren't settings any more.
  if (configCandidate !== null && typeof configCandidate === 'object') {
    for (const key of ['llmBaseUrl', 'llmApiKey', 'llmModel']) delete (configCandidate as Record<string, unknown>)[key];
  }

  const result = validatePartialConfig(configCandidate);
  if (!result.ok) {
    return err(
      `That doesn't look like a Prism settings file${result.path ? ` (${result.path}: ${result.message})` : ''}.`,
    );
  }
  return ok(result.value);
}
