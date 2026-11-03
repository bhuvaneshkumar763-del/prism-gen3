import { err, ok, type Result } from '../result';
import { applyConfigMigrations } from './migrations';
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

  // Backups carry no schema version, so every migration runs; each one
  // leaves already-current settings unchanged.
  const migratedCandidate =
    configCandidate !== null && typeof configCandidate === 'object' && !Array.isArray(configCandidate)
      ? applyConfigMigrations({ ...(configCandidate as Record<string, unknown>) }, 0)
      : configCandidate;

  const result = validatePartialConfig(migratedCandidate);
  if (!result.ok) {
    return err(
      `That doesn't look like a Prism settings file${result.path ? ` (${result.path}: ${result.message})` : ''}.`,
    );
  }
  return ok(result.value);
}
