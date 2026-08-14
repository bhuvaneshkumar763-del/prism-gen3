/**
 * A bounded, best-effort guard against a class of silent bad translation —
 * Phase 5 of the graceful-degradation pass. Real, explainable failure
 * modes this catches: a proxy/gateway that swallows a request and echoes
 * the original text back unchanged, or a provider that returns an empty
 * string for a real piece of text.
 *
 * Deliberately NOT provably complete — see `batchedHttpProvider.ts`'s
 * `handleBatch` for where this plugs into the existing one-shot repair
 * path (reused, not a new retry mechanism), and this project's own
 * verification convention: this needs a live-traffic check before it's
 * trusted, not just unit tests, given the false-positive risk called out
 * below.
 */

export interface SanityCheckResult {
  text: string;
  detectedLanguage: string | null;
}

/**
 * Short strings that are legitimately identical across a language pair
 * (numbers, acronyms, proper nouns — "2024", "OK", "NASA") are common and
 * correct, not a translation failure — only a long identical result is
 * suspicious enough to flag.
 */
const MIN_SUSPICIOUS_IDENTICAL_LENGTH = 40;

/**
 * `true` if `result` looks like a translation that silently failed rather
 * than a real (possibly legitimate) output — `original` unchanged when it
 * shouldn't be, or empty when it shouldn't be.
 */
export function isSuspiciousOutcome(
  original: string,
  result: SanityCheckResult,
  sourceLanguage: string,
  targetLanguage: string,
): boolean {
  const trimmedOriginal = original.trim();
  const trimmedResult = result.text.trim();

  if (trimmedOriginal.length === 0) return false; // nothing to translate, nothing to flag
  if (trimmedResult.length === 0) return true; // empty result for real input — a real failure signature

  if (trimmedResult !== trimmedOriginal) return false; // genuinely translated — nothing suspicious
  if (trimmedOriginal.length <= MIN_SUSPICIOUS_IDENTICAL_LENGTH) return false; // short identical string — likely legitimate

  // The provider's own detected source language says this text was
  // already in the target language — an identical result is then the
  // CORRECT no-op, not a failure.
  if (result.detectedLanguage) return result.detectedLanguage !== targetLanguage;
  // No detected-language signal from the provider — fall back to the
  // request's own declared languages. 'auto' means we don't actually know
  // the source, so there's no basis to call an identical result wrong.
  if (sourceLanguage === 'auto') return false;
  return sourceLanguage !== targetLanguage;
}
