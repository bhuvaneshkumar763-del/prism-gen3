/** Any Unicode letter. Not global, so `.test()` keeps no `lastIndex` between calls. */
export const HAS_LETTER = /\p{L}/u;

export function hasLetter(text: string): boolean {
  return HAS_LETTER.test(text);
}
