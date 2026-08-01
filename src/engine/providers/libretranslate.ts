import type { Translator } from '../translator';
import { createBatchedHttpProvider } from './batchedHttpProvider';

/**
 * LibreTranslate provider — a real, documented JSON HTTP API
 * (https://libretranslate.com/docs). Session 2's first vertical slice used
 * this provider directly against a single string; Session 4 rebuilds it on
 * the shared `createBatchedHttpProvider` machinery now that there's more
 * than one provider to generalize the batching/retry/dedupe logic across.
 *
 * LibreTranslate's `q` field accepts either a string or an array of
 * strings (real batch support) — used here at the "bundle multiple pieces
 * into one HTTP request" level. For a piece with more than one string
 * (grouped context, once the page-translation engine groups sibling DOM
 * nodes — a later session), there's no HTML-marker scheme to reuse
 * (LibreTranslate is plain text, not HTML-aware) — a simple separator
 * character does the job, same idea as the LLM provider's approach.
 */

const PIECE_PART_SEPARATOR = '␟'; // U+241F SYMBOL FOR UNIT SEPARATOR

interface LibreTranslateBatchResponse {
  translatedText?: string[];
  error?: string;
}

export interface LibreTranslateOptions {
  /** e.g. "https://libretranslate.com" or a self-hosted instance. No trailing slash. */
  baseUrl: string;
  apiKey?: string;
}

export function createLibreTranslateProvider(options: LibreTranslateOptions): Translator {
  return createBatchedHttpProvider({
    name: 'libretranslate',
    baseUrl: `${options.baseUrl}/translate`,
    method: 'POST',
    callbacks: {
      transformPiece: (strings) => strings.join(PIECE_PART_SEPARATOR),
      getRequestBody: (sourceLanguage, targetLanguage, pieceWireTexts) =>
        JSON.stringify({
          q: pieceWireTexts,
          source: sourceLanguage,
          target: targetLanguage,
          format: 'text',
          ...(options.apiKey ? { api_key: options.apiKey } : {}),
        }),
      getExtraHeaders: () => [{ name: 'Content-Type', value: 'application/json' }],
      parseResponse: (response) => {
        const body = response as LibreTranslateBatchResponse;
        if (body.error || !Array.isArray(body.translatedText)) return [];
        return body.translatedText.map((text) => ({ text, detectedLanguage: null }));
      },
      splitPieceResponse: (raw) => raw.split(PIECE_PART_SEPARATOR),
    },
  });
}
