import { type ConfigKey, defaultConfig } from '../shared/config/schema';
import { translationCache } from './cache/translationCache';
import { configStore } from './configStore';

/**
 * On-device diagnostics: probes what actually works in the running browser
 * (storage round trip, cache, API availability) instead of assuming.
 */

const REDACTED_KEY_SUFFIXES = ['ApiKey'];

function isRedactedKey(key: string): boolean {
  return REDACTED_KEY_SUFFIXES.some((suffix) => key.endsWith(suffix));
}

export interface DiagnosticsReport {
  storageRoundTripOk: boolean;
  cacheSizeBytes: number | null;
  hasI18nDetectLanguage: boolean;
  hasIndexedDb: boolean;
  effectiveConfig: Record<string, unknown>;
}

async function checkStorageRoundTrip(): Promise<boolean> {
  const testKey = '__prism_diagnostics_probe__';
  const testValue = `probe-${Date.now()}`;
  try {
    await browser.storage.local.set({ [testKey]: testValue });
    const result = await browser.storage.local.get(testKey);
    await browser.storage.local.remove(testKey);
    return result[testKey] === testValue;
  } catch {
    return false;
  }
}

function buildEffectiveConfigSnapshot(): Record<string, unknown> {
  const snapshot: Record<string, unknown> = {};
  for (const key of Object.keys(defaultConfig) as ConfigKey[]) {
    snapshot[key] = isRedactedKey(key) ? '(redacted)' : configStore.get(key);
  }
  return snapshot;
}

export async function runDiagnostics(): Promise<DiagnosticsReport> {
  await configStore.onReady();

  const [storageRoundTripOk, cacheSizeBytes] = await Promise.all([
    checkStorageRoundTrip(),
    translationCache.getSizeBytes().catch(() => null),
  ]);

  return {
    storageRoundTripOk,
    cacheSizeBytes,
    hasI18nDetectLanguage: typeof browser.i18n?.detectLanguage === 'function',
    hasIndexedDb: typeof indexedDB !== 'undefined',
    effectiveConfig: buildEffectiveConfigSnapshot(),
  };
}

const KB = 1024;
const MB = 1024 * 1024;

/** The cache size as a person reads it: "Empty", "0.3 KB", "200 KB", "12.3 MB". */
export function formatCacheSize(bytes: number | null): string {
  if (bytes === null) return 'Unavailable';
  if (bytes <= 0) return 'Empty';
  if (bytes < MB) {
    const kb = bytes / KB;
    return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  }
  return `${(bytes / MB).toFixed(1)} MB`;
}

export interface DiagnosticsRow {
  label: string;
  value: string;
  /** `info` is a plain figure, neither good nor bad. */
  status: 'ok' | 'fail' | 'info';
}

function check(label: string, ok: boolean, yes: string, no: string): DiagnosticsRow {
  return { label, value: ok ? yes : no, status: ok ? 'ok' : 'fail' };
}

/** The report in plain words, for Settings → Advanced. */
export function describeDiagnostics(report: DiagnosticsReport): DiagnosticsRow[] {
  return [
    check('Saving settings', report.storageRoundTripOk, 'Working', 'Not working'),
    check('Language detection', report.hasI18nDetectLanguage, 'Available', 'Not available'),
    check('Translation cache storage', report.hasIndexedDb, 'Available', 'Not available'),
    { label: 'Translation cache size', value: formatCacheSize(report.cacheSizeBytes), status: 'info' },
  ];
}
