import { baseLanguageTag, languageName } from './languages';

/** Google's Chinese codes name a script, so "Chinese (China)" would be the wrong label. */
const SCRIPT_NAMED_VARIANTS = new Map<string, string>([
  ['zh-cn', 'Chinese (Simplified)'],
  ['zh-sg', 'Chinese (Simplified)'],
  ['zh-hans', 'Chinese (Simplified)'],
  ['zh-tw', 'Chinese (Traditional)'],
  ['zh-hk', 'Chinese (Traditional)'],
  ['zh-hant', 'Chinese (Traditional)'],
]);

let displayNames: Intl.DisplayNames | null | undefined;

function intlLanguageName(code: string): string | null {
  if (displayNames === undefined) {
    try {
      displayNames = new Intl.DisplayNames(['en'], { type: 'language', fallback: 'none' });
    } catch {
      displayNames = null;
    }
  }
  try {
    return displayNames?.of(code) ?? null;
  } catch {
    // A malformed tag throws a RangeError.
    return null;
  }
}

/**
 * A language code as a person reads it ("zh-CN" -> "Chinese (Simplified)"),
 * for lists that store codes. An unknown code is shown as-is.
 */
export function languageLabel(code: string): string {
  if (!code) return code;
  const variant = SCRIPT_NAMED_VARIANTS.get(code.toLowerCase());
  if (variant) return variant;
  const common = languageName(code);
  if (common !== code) return common;
  const fromIntl = intlLanguageName(code);
  if (fromIntl && fromIntl.toLowerCase() !== code.toLowerCase()) return fromIntl;
  const base = baseLanguageTag(code);
  const baseName = languageName(base);
  return baseName === base ? code : `${baseName} (${code})`;
}
