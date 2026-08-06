import type { Translator } from '../translator';
import { createBatchedHttpProvider } from './batchedHttpProvider';

/**
 * The real, official Google Cloud Translation API (v2 REST) —
 * https://cloud.google.com/translate/docs/reference/rest/v2/translate.
 * User's own API key + billing, same trust tier as the LLM provider.
 * Added specifically because it's the closest available
 * match to what Arc's browser translate feature actually uses (confirmed
 * live — see docs/decisions/0004-provider-scope.md) — unlike
 * `google.ts`'s free scraped `translateHtml` endpoint, this is Google's
 * real product-grade translation quality.
 */

const API_URL = 'https://translation.googleapis.com/language/translate/v2';
const PIECE_PART_SEPARATOR = '␟'; // U+241F — same convention as llm.ts

interface GoogleCloudTranslateResponse {
  data?: {
    translations?: Array<{ translatedText: string; detectedSourceLanguage?: string }>;
  };
  error?: { message?: string };
}

export interface GoogleCloudTranslateOptions {
  apiKey: string;
}

export function createGoogleCloudTranslateProvider(options: GoogleCloudTranslateOptions): Translator {
  return createBatchedHttpProvider({
    name: 'googleCloudTranslate',
    baseUrl: `${API_URL}?key=${encodeURIComponent(options.apiKey)}`,
    method: 'POST',
    callbacks: {
      transformPiece: (strings) => strings.join(PIECE_PART_SEPARATOR),
      getRequestBody: (sourceLanguage, targetLanguage, pieceWireTexts) =>
        JSON.stringify({
          q: pieceWireTexts,
          source: sourceLanguage === 'auto' ? undefined : sourceLanguage,
          target: targetLanguage,
          format: 'text',
        }),
      getExtraHeaders: () => [{ name: 'Content-Type', value: 'application/json' }],
      parseResponse: (response) => {
        const body = response as GoogleCloudTranslateResponse;
        if (body.error || !body.data?.translations) return [];
        return body.data.translations.map((t) => ({
          text: t.translatedText,
          detectedLanguage: t.detectedSourceLanguage ?? null,
        }));
      },
      splitPieceResponse: (raw) => raw.split(PIECE_PART_SEPARATOR),
    },
  });
}
