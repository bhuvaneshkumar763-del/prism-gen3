#!/usr/bin/env node
// Serves the iPhone Simulator check's pages on localhost and collects what
// each page reports about itself (see pages/check.js). Node built-ins only.
//
//   node tests/ios-sim/server.mjs [port] [results-file]
//
// GET /<page>.html   a page from pages/ (vietnamese-long.html is generated)
// POST /report       { page, ...fields } from a page; merged per page
// GET /results       every page's latest report, as JSON

import { readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pagesDir = join(here, 'pages');
const port = Number(process.argv[2] ?? 8080);
const resultsFile = process.argv[3] ?? join(here, 'results.json');
const results = {};

const SENTENCES = [
  'Trời đã tối, gió lạnh thổi qua khu rừng phía sau ngọn núi.',
  'Hắn đứng lặng một lúc lâu rồi chậm rãi bước về phía cổng thành.',
  'Mọi người trong quán trọ đều im lặng nhìn theo bóng lưng của hắn.',
  'Không ai biết rằng trận chiến thật sự chỉ vừa mới bắt đầu.',
  'Ánh trăng chiếu xuống mặt hồ, phản chiếu những con sóng nhỏ lấp lánh.',
  'Bà lão bán trà mỉm cười, đưa cho hắn một chén nước còn ấm.',
];

/** About 1,500 words, one element per word, as on sangtacviet chapters. */
function vietnameseLongPage() {
  const paragraphs = [];
  for (let p = 0; p < 24; p++) {
    const words = [];
    for (let s = 0; s < 5; s++) words.push(...SENTENCES[(p + s) % SENTENCES.length].split(' '));
    // Punctuation sits between the word elements, as sangtacviet writes it.
    const html = words.map((w) => {
      const [, word, punct] = /^(.*?)([,.!?]*)$/.exec(w) ?? [w, w, ''];
      return `<i>${word}</i>${punct}`;
    });
    paragraphs.push(`<p class="c">${html.join(' ')}</p>`);
  }
  return readFileSync(join(pagesDir, 'vietnamese-long.template.html'), 'utf8').replace(
    '<!-- paragraphs -->',
    paragraphs.join('\n'),
  );
}

function send(res, status, type, body) {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(body);
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (req.method === 'POST' && url.pathname === '/report') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      try {
        const report = JSON.parse(body);
        results[report.page] = { ...results[report.page], ...report, at: new Date().toISOString() };
        writeFileSync(resultsFile, `${JSON.stringify(results, null, 2)}\n`);
        send(res, 204, 'text/plain', '');
      } catch {
        send(res, 400, 'text/plain', 'bad report');
      }
    });
    return;
  }
  if (url.pathname === '/results') return send(res, 200, 'application/json', JSON.stringify(results));
  if (url.pathname === '/vietnamese-long.html') return send(res, 200, 'text/html; charset=utf-8', vietnameseLongPage());
  const file = normalize(join(pagesDir, url.pathname === '/' ? 'index.html' : url.pathname));
  if (!file.startsWith(pagesDir)) return send(res, 403, 'text/plain', 'no');
  try {
    const type = file.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8';
    send(res, 200, type, readFileSync(file));
  } catch {
    send(res, 404, 'text/plain', 'not found');
  }
});

server.listen(port, () => console.log(`ios-sim pages on http://localhost:${port}/, results in ${resultsFile}`));
