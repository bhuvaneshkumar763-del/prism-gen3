import type { Translator } from '../translator';
import { createBatchedHttpProvider } from './batchedHttpProvider';

/**
 * Provider-agnostic LLM translation: OpenAI-compatible chat-completions
 * shape (base URL + API key + model, all user-supplied), so it works
 * against OpenAI, a cloud gateway, OR a local server (Ollama, LM Studio,
 * llama.cpp server's OpenAI-compat mode, ...) — "local model" support is
 * inherent to this design (a local server is just a different base URL),
 * not a separate feature.
 *
 * Sends all segments bundled into the HTTP request as one numbered-list
 * prompt and expects one JSON array of translations back — this shapes
 * naturally onto the shared batched-provider machinery (each HTTP request
 * = the whole numbered prompt; each "piece" here is one numbered segment).
 * Multi-string pieces (grouped context, once a later session's
 * page-translation engine groups sibling DOM nodes) are joined/split with
 * a Unicode separator, same idea as `libretranslate.ts`/
 * `googleCloudTranslate.ts`.
 */

const PIECE_PART_SEPARATOR = '␟'; // U+241F SYMBOL FOR UNIT SEPARATOR

function buildPrompt(sourceLanguage: string, targetLanguage: string, segments: string[]): string {
  const sourceClause = sourceLanguage && sourceLanguage !== 'auto' ? `from ${sourceLanguage} ` : '';
  const numbered = segments.map((s, i) => `[${i}]: ${s}`).join('\n');
  return (
    `Translate the following ${segments.length} numbered text segments ${sourceClause}into ${targetLanguage}. ` +
    `Some segments contain the character ${PIECE_PART_SEPARATOR} separating multiple independent parts — ` +
    `preserve that exact character and the same number of parts in your translation of that segment. ` +
    `Keep whitespace/line-break structure. Do not translate content inside segments that looks like code, ` +
    `a URL, or a placeholder token. Respond with ONLY a JSON array of exactly ${segments.length} strings, ` +
    `one per segment, in the same order — no markdown fencing, no explanation, nothing else.\n\n${numbered}`
  );
}

/** Strips common markdown code-fence wrapping models add despite instructions not to, before JSON.parse. */
function extractJsonArrayText(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced?.[1] ?? trimmed;
}

interface OpenAiChatResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

export interface LlmProviderOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export function createLlmProvider(options: LlmProviderOptions): Translator {
  return createBatchedHttpProvider({
    name: 'llm',
    baseUrl: options.baseUrl,
    method: 'POST',
    // A whole batch is one prompt — cap the batch generously since
    // "bundle up to N chars" here means "bundle up to N chars of numbered
    // segments into one prompt," and a bigger prompt gives the model more
    // context to translate consistently, not just fewer round trips.
    maxBatchChars: 4000,
    callbacks: {
      transformPiece: (strings) => strings.join(PIECE_PART_SEPARATOR),
      getRequestBody: (sourceLanguage, targetLanguage, pieceWireTexts) =>
        JSON.stringify({
          model: options.model,
          temperature: 0,
          messages: [{ role: 'user', content: buildPrompt(sourceLanguage, targetLanguage, pieceWireTexts) }],
        }),
      getExtraHeaders: () => [
        { name: 'Content-Type', value: 'application/json' },
        { name: 'Authorization', value: `Bearer ${options.apiKey}` },
      ],
      parseResponse: (response) => {
        const body = response as OpenAiChatResponse;
        const content = body.choices?.[0]?.message?.content;
        if (!content) return [];
        let parsed: unknown;
        try {
          parsed = JSON.parse(extractJsonArrayText(content));
        } catch (e) {
          console.error('[llm] failed to parse model response as JSON', e, content);
          return [];
        }
        if (!Array.isArray(parsed)) return [];
        // A non-string entry (malformed model output) becomes an empty
        // string rather than throwing — the shared base's per-piece
        // "missing result" repair pass already treats an empty/missing
        // result as a retry candidate, so one bad slot doesn't need to
        // fail the whole batch here.
        return parsed.map((text) => ({ text: typeof text === 'string' ? text : '', detectedLanguage: null }));
      },
      splitPieceResponse: (raw) => raw.split(PIECE_PART_SEPARATOR),
    },
  });
}
