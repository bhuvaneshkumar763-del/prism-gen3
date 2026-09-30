// Downloads the Mozilla-signed .xpi for a release that was already submitted
// to AMO — for when the Release workflow's signing step gave up waiting for
// approval and published an unsigned zip instead (beta.69 and beta.70 both
// did, Sept 2026, while the step still reported success).
//
// Run by .github/workflows/fetch-signed-xpi.yml. Node built-ins only, so it
// needs no install step and pulls nothing from npm at run time.
//
// Env: AMO_JWT_ISSUER, AMO_JWT_SECRET, VERSION (e.g. "0.3.0-beta.70"),
// optional OUT_DIR (default "."). Writes the path of the saved file to
// $GITHUB_OUTPUT as `xpi=<path>` when running in Actions.
//
// Exit codes: 0 saved; 2 Mozilla has it but hasn't approved it yet (not an
// error, just not ready); 1 anything else.

import { createHmac, randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ADDON_GUID = 'prism-gen3@bhuvaneshkumar763-del.github.io';
const API = 'https://addons.mozilla.org/api/v5';

/**
 * The version string Mozilla knows a release by. Must match wxt.config.ts,
 * which turns "0.3.0-beta.70" into the 4-part "0.3.0.70" (WXT's own default
 * would collapse every beta to "0.3.0").
 */
export function amoVersionFor(releaseVersion) {
  const beta = /^(\d+\.\d+\.\d+)-beta\.(\d+)$/.exec(releaseVersion);
  return beta ? `${beta[1]}.${beta[2]}` : releaseVersion;
}

/** AMO's API auth: a short-lived HS256 JWT, a fresh one per request (each needs a unique jti). */
export function amoJwt(issuer, secret, nowSeconds = Math.floor(Date.now() / 1000)) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const unsigned = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({
    iss: issuer,
    jti: randomUUID(),
    iat: nowSeconds,
    exp: nowSeconds + 60,
  })}`;
  const signature = createHmac('sha256', secret).update(unsigned).digest('base64url');
  return `${unsigned}.${signature}`;
}

/** True for a zip that carries Mozilla's signature files. */
export function looksSigned(bytes) {
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
  const text = bytes.toString('latin1');
  return isZip && (text.includes('META-INF/mozilla.rsa') || text.includes('META-INF/cose.sig'));
}

async function amoGet(url, issuer, secret) {
  const response = await fetch(url, { headers: { Authorization: `JWT ${amoJwt(issuer, secret)}` } });
  if (!response.ok) {
    const body = (await response.text()).slice(0, 300);
    throw new Error(`Mozilla returned HTTP ${response.status} for ${url}: ${body}`);
  }
  return response;
}

async function main() {
  const { AMO_JWT_ISSUER: issuer, AMO_JWT_SECRET: secret, VERSION: version, OUT_DIR: outDir = '.' } = process.env;
  if (!issuer || !secret) throw new Error('AMO_JWT_ISSUER and AMO_JWT_SECRET must both be set.');
  // Validated before use: it comes from a workflow input and ends up in a file name.
  if (!version || !/^\d+\.\d+\.\d+(-beta\.\d+)?$/.test(version)) {
    throw new Error(`VERSION must look like 0.3.0-beta.70, got ${JSON.stringify(version)}.`);
  }
  const amoVersion = amoVersionFor(version);

  const seen = [];
  let next = `${API}/addons/addon/${encodeURIComponent(ADDON_GUID)}/versions/?filter=all_with_unlisted&page_size=50`;
  let match = null;
  while (next && !match) {
    const page = await (await amoGet(next, issuer, secret)).json();
    for (const entry of page.results ?? []) {
      seen.push(entry.version);
      if (entry.version === amoVersion) match = entry;
    }
    next = page.next;
  }
  if (!match) {
    throw new Error(
      `Mozilla has no version ${amoVersion} (from ${version}). Versions it does have: ${seen.join(', ') || 'none'}.`,
    );
  }

  const file = match.file ?? {};
  if (file.status !== 'public' || !file.url) {
    console.log(
      `Mozilla has ${amoVersion} but hasn't approved it yet (file status: ${file.status ?? 'unknown'}). Try again later.`,
    );
    process.exit(2);
  }

  const bytes = Buffer.from(await (await amoGet(file.url, issuer, secret)).arrayBuffer());
  if (!looksSigned(bytes)) {
    throw new Error(`Downloaded ${bytes.length} bytes for ${amoVersion}, but it isn't a signed XPI.`);
  }
  mkdirSync(outDir, { recursive: true });
  const path = join(outDir, `prism-gen3-${version}-firefox.xpi`);
  writeFileSync(path, bytes);
  console.log(`Saved the signed ${amoVersion} (${bytes.length} bytes) to ${path}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `xpi=${path}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
