/**
 * The manifest `version` for a package.json version. Browser manifests and
 * Mozilla's add-on site allow only 1–4 dot-separated numbers, and compare them
 * part by part with missing parts counted as zero.
 *
 * - A prerelease `X.Y.Z-<tag>.N` becomes `X.Y.Z.N`.
 * - A stable `X.Y.Z` becomes `X.Y.Z.9999`, so it sorts above its own betas.
 *   Plain `X.Y.Z` would sort below them, which is what made 0.3.0 unusable.
 * - Stable versions up to 0.3.1 keep their plain form: Mozilla already holds
 *   them under that version, and fetch-signed-xpi looks them up by it.
 *
 * Used by wxt.config.ts and scripts/fetch-signed-xpi.mjs, so the built
 * extension and the Mozilla lookup always agree.
 */
const STABLE_SUFFIX = 9999;
const LAST_PLAIN_STABLE: readonly [number, number, number] = [0, 3, 1];

export function manifestVersionFor(packageVersion: string): string {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-[a-z]+\.(\d+))?$/.exec(packageVersion);
  if (!match)
    throw new Error(`Cannot turn "${packageVersion}" into a manifest version (expected X.Y.Z or X.Y.Z-tag.N)`);
  const [, major, minor, patch, prerelease] = match;
  const base = `${major}.${minor}.${patch}`;
  if (prerelease !== undefined) {
    if (Number(prerelease) >= STABLE_SUFFIX) {
      throw new Error(`Prerelease number in "${packageVersion}" must be below ${STABLE_SUFFIX}`);
    }
    return `${base}.${Number(prerelease)}`;
  }
  return isAtMostLastPlainStable([Number(major), Number(minor), Number(patch)]) ? base : `${base}.${STABLE_SUFFIX}`;
}

function isAtMostLastPlainStable(version: [number, number, number]): boolean {
  for (let i = 0; i < 3; i++) {
    // biome-ignore lint/style/noNonNullAssertion: both tuples have three parts
    if (version[i]! !== LAST_PLAIN_STABLE[i]!) return version[i]! < LAST_PLAIN_STABLE[i]!;
  }
  return true;
}
