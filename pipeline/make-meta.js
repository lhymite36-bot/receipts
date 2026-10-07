#!/usr/bin/env node
// Builds YouTube metadata (title, description with #shorts, tags) for one rendered Short.
// Usage: node pipeline/make-meta.js <plan.json> <n> <short.pkg.json> > shortN.meta.json
const fs = require('fs');
const [PLAN, N, PKG] = process.argv.slice(2);
const plan = JSON.parse(fs.readFileSync(PLAN, 'utf8')); const it = plan.items.find((x) => String(x.n) === String(N));
const p0 = JSON.parse(fs.readFileSync(PKG, 'utf8')); const pkg = p0.pkg || p0;
const HANDLE = process.env.HANDLE || '@ReceiptsDaily';
const clean = (s) => String(s || '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim();
let title = clean(pkg.title || it.claim);
if (title.length > 92) title = title.slice(0, 91).replace(/\s+\S*$/, '') + '…';
title += ' #shorts'; // ≤100 chars total
const tagify = (h) => String(h).replace(/^#/, '').replace(/[^\p{L}\p{N}]/gu, '');
const hs = [...new Set(['shorts', 'mythbusting', 'receipts', ...((pkg.hashtags || []).map(tagify)), ...it.tags.map(tagify)].filter((x) => x && x.length <= 24).map((x) => x.toLowerCase()))].slice(0, 8);
const description = [clean(pkg.description || pkg.textHook || it.claim), '', 'The receipt: ' + clean(it.receipt), '',
  'Which myth should we stamp next? Comment below 👇', ...(String(pkg.description || '').includes(HANDLE) ? [] : ['Follow ' + HANDLE + ' for a new receipt every few hours.']), '', hs.map((h) => '#' + h).join(' ')].join('\n').slice(0, 4900);
const base = ['myth busting', 'myths debunked', 'fact check', 'receipts', 'science facts', 'did you know', 'shorts', 'funny facts'];
const tags = []; let len = 0;
for (const t of [...it.tags, ...base, ...hs]) { const x = clean(t).toLowerCase(); if (!x || tags.includes(x) || len + x.length + 3 > 480) continue; tags.push(x); len += x.length + 3; }
process.stdout.write(JSON.stringify({ n: it.n, id: it.id, title, description, tags, categoryId: '27', publishAt: it.publishAt, slotIST: it.slotIST }, null, 1) + '\n');
