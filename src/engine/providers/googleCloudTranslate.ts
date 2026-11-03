import type { Translator } from '../translator';
import { createBatchedHttpProvider } from './batchedHttpProvider';

/**
 * The official Google Cloud Translation API (v2 REST), with the user's own
 * key and billing: https://cloud.google.com/translate/docs/reference/rest/v2/translate
 */

const API_URL = 'https://translation.googleapis.com/language/translate/v2';
const PIECE_PART_SEPARATOR = '␟'; // U+241F SYMBOL FOR UNIT SEPARATOR
// A literal separator in page text would misalign every later node, so it's
// swapped for a placeholder on the way out and restored on return.
const ESCAPED_SEPARATOR_PLACEHOLDER = '';
function escapeSeparator(s: string): string {
  return s.replaceAll(PIECE_PART_SEPARATOR, ESCAPED_SEPARATOR_PLACEHOLDER);
}
function unescapeSeparator(s: string): string {
  return s.replaceAll(ESCAPED_SEPARATOR_PLACEHOLDER, PIECE_PART_SEPARATOR);
}

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
    baseUrl: API_URL,
    method: 'POST',
    // Google's documented per-request segment limit for the v2 translate endpoint.
    maxBatchPieces: 128,
    callbacks: {
      transformPiece: (strings) => strings.map(escapeSeparator).join(PIECE_PART_SEPARATOR),
      getRequestBody: (sourceLanguage, targetLanguage, pieceWireTexts) =>
        JSON.stringify({
          q: pieceWireTexts,
          source: sourceLanguage === 'auto' ? undefined : sourceLanguage,
          target: targetLanguage,
          format: 'text',
        }),
      getExtraHeaders: () => [
        { name: 'Content-Type', value: 'application/json' },
        { name: 'X-Goog-Api-Key', value: options.apiKey },
      ],
      parseResponse: (response) => {
        const body = response as GoogleCloudTranslateResponse;
        if (body.error || !body.data?.translations) return [];
        return body.data.translations.map((t) => ({
          text: t.translatedText,
          detectedLanguage: t.detectedSourceLanguage ?? null,
        }));
      },
      splitPieceResponse: (raw) => raw.split(PIECE_PART_SEPARATOR).map(unescapeSeparator),
    },
  });
}
