import { fakeBrowser } from '@webext-core/fake-browser';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

  it('reports true for scripting API and IndexedDB availability in this test environment', async () => {
    const runDiagnostics = await freshRunDiagnostics();
    const report = await runDiagnostics();
    expect(report.hasScriptingApi).toBe(true);
    expect(report.hasIndexedDb).toBe(true);
  });

  it('includes the effective config snapshot with API key fields redacted', async () => {
    await fakeBrowser.storage.local.set({ llmApiKey: 'sk-real-secret', targetLanguage: 'fr' });
    const runDiagnostics = await freshRunDiagnostics();
    const report = await runDiagnostics();
    expect(report.effectiveConfig.llmApiKey).toBe('(redacted)');
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
