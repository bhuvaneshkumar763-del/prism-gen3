import { err, ok } from '../../shared/result';
import type { Translator as EngineTranslator, PieceOutcome, TranslateBatchRequest } from '../translator';

/**
 * On-device translation via Chrome's built-in Translator API — the same
 * on-device Gemini Nano model Chrome's own native "translate this page"
 * feature uses (confirmed live — see docs/decisions/0004-provider-scope.md),
 * making this the closest match to the Chrome-native experience of any
 * provider in this project. No API key, no network call — the model is
 * downloaded locally by the browser itself the first time a language pair
 * is used. Feature-detected via `descriptors.ts`'s `isAvailable` — this
 * provider is simply unreachable on Firefox or older Chrome.
 *
 * Not built on `createBatchedHttpProvider` — there's no HTTP request at
 * all here (no XHR/retry/concurrency to reuse), and the Translator API has
 * its own async instance-creation lifecycle (one instance per language
 * pair, reused across calls) that doesn't map onto the shared base's
 * request-batching shape. Deliberately no `batchingHint` in
 * `descriptors.ts`: on-device calls have no network round-trip to
 * amortize, so per-piece granularity is already fine.
 */

interface BuiltinTranslatorInstance {
  translate(text: string): Promise<string>;
  destroy?(): void;
}

type TranslatorAvailability = 'unavailable' | 'downloadable' | 'downloading' | 'available';

interface BuiltinTranslatorStatic {
  availability(options: { sourceLanguage: string; targetLanguage: string }): Promise<TranslatorAvailability>;
  create(options: { sourceLanguage: string; targetLanguage: string }): Promise<BuiltinTranslatorInstance>;
}

declare global {
  // Not yet in TypeScript's DOM lib — minimal ambient declaration covering
  // only what this file uses. Source of truth:
  // https://developer.chrome.com/docs/ai/translator-api
  var Translator: BuiltinTranslatorStatic | undefined;
}

// One Translator instance per language pair, reused across calls — creating
// one is async and may involve a model download on first use per pair.
const translatorsByLanguagePair = new Map<string, Promise<BuiltinTranslatorInstance>>();

function getTranslatorInstance(sourceLanguage: string, targetLanguage: string): Promise<BuiltinTranslatorInstance> {
  const key = `${sourceLanguage}:${targetLanguage}`;
  let instance = translatorsByLanguagePair.get(key);
  if (!instance) {
    if (typeof Translator === 'undefined') throw new Error('Translator API unavailable');
    instance = Translator.create({ sourceLanguage, targetLanguage });
    translatorsByLanguagePair.set(key, instance);
    // If creation itself fails (e.g. this pair turns out unsupported
    // despite availability() saying otherwise), don't leave a rejected
    // promise cached forever — let the next call retry.
    instance.catch(() => translatorsByLanguagePair.delete(key));
  }
  return instance;
}

async function translatePiece(translatorInstance: BuiltinTranslatorInstance, strings: string[]): Promise<PieceOutcome> {
  try {
    const translated = await Promise.all(strings.map((text) => translatorInstance.translate(text)));
    return ok(translated);
  } catch (e) {
    return err({ kind: 'network', message: `[builtin] translate failed: ${e}` });
  }
}

export function createBuiltinProvider(): EngineTranslator {
  return {
    async translateBatch(request: TranslateBatchRequest): Promise<PieceOutcome[]> {
      const { sourceLanguage, targetLanguage, pieces } = request;

      if (typeof Translator === 'undefined') {
        return pieces.map(() => err({ kind: 'network', message: '[builtin] Translator API unavailable' }));
      }

      const availability = await Translator.availability({ sourceLanguage, targetLanguage }).catch(
        () => 'unavailable' as const,
      );
      if (availability === 'unavailable') {
        return pieces.map(() => err({ kind: 'network', message: '[builtin] language pair unavailable' }));
      }

      let translatorInstance: BuiltinTranslatorInstance;
      try {
        translatorInstance = await getTranslatorInstance(sourceLanguage, targetLanguage);
      } catch (e) {
        return pieces.map(() => err({ kind: 'network', message: `[builtin] failed to create translator: ${e}` }));
      }

      return Promise.all(pieces.map((piece) => translatePiece(translatorInstance, piece)));
    },
  };
}
