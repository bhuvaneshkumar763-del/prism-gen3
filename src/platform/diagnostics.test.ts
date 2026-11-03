import { fakeBrowser } from '@webext-core/fake-browser';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type DiagnosticsReport, describeDiagnostics, formatCacheSize } from './diagnostics';

// diagnostics.ts imports the module-level `configStore` singleton
// directly (not injected) — like configStore.test.ts, each test needs a
// fresh module graph via vi.resetModules() + a dynamic import, or state
// (and the "already ready" cached promise) would leak across tests that
// otherwise look independent.
async function freshRunDiagnostics() {
  vi.resetModules();
  const { runDiagnostics } = await import('./diagnostics');
  return runDiagnostics;
}

describe('runDiagnostics', () => {
  beforeEach(() => {
    fakeBrowser.reset();
    globalThis.indexedDB = new IDBFactory();
  });

  it('reports a successful storage round trip and does not leave the probe key behind', async () => {
    const runDiagnostics = await freshRunDiagnostics();
    const report = await runDiagnostics();
    expect(report.storageRoundTripOk).toBe(true);
    const raw = await fakeBrowser.storage.local.get(null);
    expect(Object.keys(raw)).not.toContain('__prism_diagnostics_probe__');
  });

  it('reports the cache size in bytes', async () => {
    const runDiagnostics = await freshRunDiagnostics();
    const report = await runDiagnostics();
    expect(report.cacheSizeBytes).toBe(0);
  });

  it('reports true for i18n.detectLanguage when the fake-browser API is present', async () => {
    const runDiagnostics = await freshRunDiagnostics();
    const report = await runDiagnostics();
    expect(report.hasI18nDetectLanguage).toBe(true);
  });

  it('reports IndexedDB availability, and does not check the scripting permission the extension never asks for', async () => {
    const runDiagnostics = await freshRunDiagnostics();
    const report = await runDiagnostics();
    expect(report.hasIndexedDb).toBe(true);
    expect(report).not.toHaveProperty('hasScriptingApi');
  });

  it('includes the effective config snapshot with API key fields redacted', async () => {
    await fakeBrowser.storage.local.set({ googleCloudTranslateApiKey: 'real-secret', targetLanguage: 'fr' });
    const runDiagnostics = await freshRunDiagnostics();
    const report = await runDiagnostics();
    expect(report.effectiveConfig.googleCloudTranslateApiKey).toBe('(redacted)');
    expect(report.effectiveConfig.targetLanguage).toBe('fr');
  });

  it('does not redact non-API-key fields', async () => {
    const runDiagnostics = await freshRunDiagnostics();
    const report = await runDiagnostics();
    expect(report.effectiveConfig.pageTranslatorProvider).not.toBe('(redacted)');
    expect(report.effectiveConfig.libreTranslateBaseUrl).not.toBe('(redacted)');
  });
});

describe('formatCacheSize', () => {
  it('says "empty" for an empty cache', () => {
    expect(formatCacheSize(0)).toBe('Empty');
  });

  it('shows small sizes in KB, never raw bytes', () => {
    expect(formatCacheSize(300)).toBe('0.3 KB');
    expect(formatCacheSize(1536)).toBe('1.5 KB');
    expect(formatCacheSize(200 * 1024)).toBe('200 KB');
  });

  it('shows large sizes in MB', () => {
    expect(formatCacheSize(5 * 1024 * 1024)).toBe('5.0 MB');
    expect(formatCacheSize(Math.round(12.34 * 1024 * 1024))).toBe('12.3 MB');
  });

  it('says when the size could not be read', () => {
    expect(formatCacheSize(null)).toBe('Unavailable');
  });
});

describe('describeDiagnostics', () => {
  const report: DiagnosticsReport = {
    storageRoundTripOk: true,
    cacheSizeBytes: 2048,
    hasI18nDetectLanguage: true,
    hasIndexedDb: false,
    effectiveConfig: {},
  };

  it('describes each check in plain words', () => {
    expect(describeDiagnostics(report)).toEqual([
      { label: 'Saving settings', value: 'Working', status: 'ok' },
      { label: 'Language detection', value: 'Available', status: 'ok' },
      { label: 'Translation cache storage', value: 'Not available', status: 'fail' },
      { label: 'Translation cache size', value: '2.0 KB', status: 'info' },
    ]);
  });

  it('uses no developer API names', () => {
    const text = JSON.stringify(describeDiagnostics({ ...report, storageRoundTripOk: false }));
    expect(text).not.toMatch(/i18n|detectLanguage|scripting|IndexedDB|bytes|round trip/i);
    expect(text).toContain('Not working');
  });
});
