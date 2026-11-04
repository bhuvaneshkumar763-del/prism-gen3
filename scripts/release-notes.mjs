#!/usr/bin/env node
// Builds a GitHub release body from CHANGELOG.md, used by release.yml:
//   node scripts/release-notes.mjs <version> <owner/repo> <out-file>
// Exits 1 (with a GitHub ::error::) when the version's entry has no real
// "Checked on:" line, so a release can't ship without its real-page check.

import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** GitHub rejects a release body over 125,000 characters. */
export const BODY_LIMIT = 120_000;
const TRIMMED_LENGTH = 118_000;

/** The text of `## <version>` in a changesets CHANGELOG, up to the next `## ` heading; '' when absent. */
export function extractSection(changelog, version) {
  const lines = changelog.split('\n');
  const start = lines.indexOf(`## ${version}`);
  if (start === -1) return '';
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith('## '));
  return (end === -1 ? rest : rest.slice(0, end)).join('\n');
}

// A check names where it ran: one of these words must appear in the line.
const BROWSER_OR_DEVICE =
  /\b(chrom(e|ium)|firefox|safari|orion|edge|brave|webkit|iphone|ipad|ios|android|mac(os)?|windows|linux|desktop|mobile)\b/i;
const DATE = /\b(\d{4})-(\d{2})-(\d{2})\b/;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Why one "Checked on:" value is incomplete, or null. A date up to a day past `now` (UTC) is allowed for zones ahead of UTC. */
function lineProblem(value, now) {
  if (value === '' || /^(todo|tbd)\b/i.test(value)) return "the 'Checked on:' line is a placeholder";
  const match = DATE.exec(value);
  if (!match) return "the 'Checked on:' line has no YYYY-MM-DD date";
  const [year, month, day] = match.slice(1).map(Number);
  const date = Date.UTC(year, month - 1, day);
  if (new Date(date).getUTCMonth() !== month - 1 || new Date(date).getUTCDate() !== day)
    return `the 'Checked on:' date ${match[0]} is not a real date`;
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  if (date > today + DAY_MS) return `the 'Checked on:' date ${match[0]} is in the future`;
  if (!BROWSER_OR_DEVICE.test(value)) return "the 'Checked on:' line names no browser or device";
  return null;
}

/**
 * Null when `notes` records a real-page check, otherwise why not. Only a line that
 * starts with "Checked on:" counts, and every such line needs a browser or device and a date.
 */
export function checkedOnProblem(notes, now = new Date()) {
  const lines = notes.split('\n').map((line) => line.trim());
  const checked = lines.filter((line) => line.startsWith('Checked on:'));
  if (checked.length === 0) return "no 'Checked on: <page>, <browser>, <date>' line";
  for (const line of checked) {
    const problem = lineProblem(line.slice('Checked on:'.length).trim(), now);
    if (problem) return problem;
  }
  return null;
}

/** `notes` cut to fit GitHub's limit, ending with a link to the full changelog; unchanged when it already fits. */
export function fitToLimit(notes, version, repository) {
  if (notes.length <= BODY_LIMIT) return { notes, trimmed: false };
  const link = `https://github.com/${repository}/blob/v${version}/CHANGELOG.md`;
  return {
    notes: `${notes.slice(0, TRIMMED_LENGTH)}\n\n…\n\nNotes trimmed to fit GitHub. Full notes: ${link}\n`,
    trimmed: true,
  };
}

function main([version, repository, outFile]) {
  if (!version || !repository || !outFile) {
    console.error('usage: node scripts/release-notes.mjs <version> <owner/repo> <out-file>');
    process.exit(1);
  }
  const section = extractSection(readFileSync('CHANGELOG.md', 'utf8'), version);
  const problem = section.trim() ? checkedOnProblem(section) : `no CHANGELOG.md entry for ${version}`;
  if (problem) {
    console.error(
      `::error::v${version}: ${problem}. Check the release on a real page first, then add the line to CHANGELOG.md and push.`,
    );
    process.exit(1);
  }
  const { notes, trimmed } = fitToLimit(section, version, repository);
  if (trimmed) console.log(`::warning::Release notes for v${version} were trimmed to fit GitHub's size limit.`);
  writeFileSync(outFile, notes);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main(process.argv.slice(2));
