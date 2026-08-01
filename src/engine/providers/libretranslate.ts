import { err, ok, type Result } from '../../shared/result';
import type { TranslateError, TranslateRequest, Translator } from '../translator';

/**
 * LibreTranslate provider — a real, documented JSON HTTP API
 * (https://libretranslate.com/docs — POST {q, source, target, format} to
 * `${baseUrl}/translate`), chosen for Session 2's first vertical slice
 * specifically because it's the simplest real provider shape: no
 * auth-token scraping, no batch-only-when->1-item quirks, no third-party
 * UI automation. Google/Bing/Yandex (scraping) and the DeepL live-tab
 * bridge are deliberately deferred to Session 4 — see the Gen 3 plan.
 *
 * `fetch` is a standard Web API, not a `chrome`/`browser`-namespaced one,
 * so calling it directly here doesn't violate the engine-purity rule (see
 * src/engine/README.md) — it works unmodified in an MV3 service worker,
 * a content script, or any future non-extension surface.
 */

interface LibreTranslateResponse {
  translatedText?: string;
  error?: string;
}

export interface LibreTranslateOptions {
  /** e.g. "https://libretranslate.com" or a self-hosted instance. No trailing slash. */
  baseUrl: string;
  apiKey?: string;
}

export function createLibreTranslateProvider(options: LibreTranslateOptions): Translator {
  return {
    async translate(request: TranslateRequest): Promise<Result<string, TranslateError>> {
      let response: Response;
      try {
        response = await fetch(`${options.baseUrl}/translate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            q: request.text,
            source: request.sourceLanguage,
            target: request.targetLanguage,
            format: 'text',
            ...(options.apiKey ? { api_key: options.apiKey } : {}),
          }),
        });
      } catch (e) {
        return err({ kind: 'network', message: e instanceof Error ? e.message : String(e) });
      }

      if (!response.ok) {
        return err({ kind: 'http', message: `LibreTranslate responded with HTTP ${response.status}` });
      }

      let body: LibreTranslateResponse;
      try {
        body = await response.json();
      } catch (e) {
        return err({ kind: 'parse', message: `Failed to parse LibreTranslate response as JSON: ${e}` });
      }

      if (body.error) {
        return err({ kind: 'http', message: body.error });
      }
      if (typeof body.translatedText !== 'string') {
        return err({ kind: 'parse', message: 'LibreTranslate response had no translatedText field' });
      }

      return ok(body.translatedText);
    },
  };
}
