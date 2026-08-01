import { type ConfigKey, defaultConfig } from '../shared/config/schema';
import { translationCache } from './cache/translationCache';
import { configStore } from './configStore';

/**
 * On-device diagnostics — probes what actually works *in the browser it's
 * running in*, rather than assuming. The old repo added an equivalent
 * panel after two separate real-world bug reports were each misdiagnosed
 * more than once before someone actually looked at the raw storage/
 * capability state — see that project's history for the account. Built
 * here from Session 1 rather than reactively, per the Gen 3 plan.
 */

const REDACTED_KEY_SUFFIXES = ['ApiKey'];

function isRedactedKey(key: string): boolean {
  return REDACTED_KEY_SUFFIXES.some((suffix) => key.endsWith(suffix));
}

export interface DiagnosticsReport {
  storageRoundTripOk: boolean;
  cacheSizeBytes: number | null;
  hasI18nDetectLanguage: boolean;
  hasScriptingApi: boolean;
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
    hasScriptingApi: typeof browser.scripting !== 'undefined',
    hasIndexedDb: typeof indexedDB !== 'undefined',
    effectiveConfig: buildEffectiveConfigSnapshot(),
  };
}
