import { readdirSync, readFileSync, writeFileSync, mkdirSync, cpSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = 'C:/Users/acofo/Documents/GitHub/svaf/src/content/posts';
const DST = 'C:/Users/acofo/Documents/GitHub/hugo-PaperMod/content/posts';

mkdirSync(DST, { recursive: true });

const slugs = readdirSync(SRC).filter(n => statSync(join(SRC, n)).isDirectory());

function parseFM(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { fm: {}, body: text, raw: '' };
  return { rawFM: m[1], body: m[2] };
}

// Minimal YAML serializer for our known fields
function yamlStr(v) {
  if (v == null) return '""';
  const s = String(v);
  if (/^[\w./:-]+$/.test(s) && !/^\d/.test(s)) return s;
  return JSON.stringify(s);
}

function buildHugoFM(src) {
  // src: raw YAML string from astro
  // Parse line-based; handle list (- item) and inline arrays [a, b]
  const lines = src.split(/\r?\n/);
  const obj = {};
  let curKey = null;
  let curList = null;
  let pendingMultiline = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (curList) {
      const lm = line.match(/^\s*-\s+(.*)$/);
      if (lm) { curList.push(lm[1].trim().replace(/^['"]|['"]$/g, '')); continue; }
      else { obj[curKey] = curList; curList = null; curKey = null; }
    }
    if (pendingMultiline !== null) {
      // continuation indented line for folded value
      if (/^\s+\S/.test(line)) { pendingMultiline.value += ' ' + line.trim(); continue; }
      else { obj[pendingMultiline.key] = pendingMultiline.value; pendingMultiline = null; }
    }
    const m = line.match(/^([A-Za-z_][\w]*):\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    let val = m[2];
    if (val === '' || val === undefined) {
      // expect list next
      curKey = key; curList = [];
      continue;
    }
    // inline array
    const arr = val.match(/^\[(.*)\]\s*$/);
    if (arr) {
      obj[key] = arr[1].split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
      continue;
    }
    // quoted
    if ((val.startsWith("'") && val.endsWith("'")) || (val.startsWith('"') && val.endsWith('"'))) {
      obj[key] = val.slice(1, -1);
      continue;
    }
    // unquoted; could continue on next indented lines (for description wrapping)
    obj[key] = val;
  }
  if (curList && curKey) obj[curKey] = curList;
  if (pendingMultiline) obj[pendingMultiline.key] = pendingMultiline.value;

  const out = {};
  if (obj.title) out.title = obj.title;
  if (obj.published) out.date = obj.published;
  if (obj.description) out.description = obj.description;
  if (obj.draft !== undefined) out.draft = obj.draft === 'true' || obj.draft === true;
  if (Array.isArray(obj.tags) && obj.tags.length) out.tags = obj.tags;
  if (obj.category) out.categories = [obj.category];
  if (obj.image && obj.image !== '') out.coverImage = obj.image;
  return out;
}

function emitYAML(o) {
  const lines = ['---'];
  for (const [k, v] of Object.entries(o)) {
    if (k === 'tags' || k === 'categories') {
      lines.push(`${k}:`);
      for (const it of v) lines.push(`  - ${yamlStr(it)}`);
    } else if (k === 'coverImage') {
      lines.push('cover:');
      lines.push(`  image: ${yamlStr(v)}`);
      lines.push(`  relative: true`);
    } else if (typeof v === 'boolean') {
      lines.push(`${k}: ${v}`);
    } else {
      lines.push(`${k}: ${yamlStr(v)}`);
    }
  }
  lines.push('---', '');
  return lines.join('\n');
}

let ok = 0, fail = 0;
for (const slug of slugs) {
  try {
    const srcDir = join(SRC, slug);
    const dstDir = join(DST, slug);
    const idx = join(srcDir, 'index.md');
    if (!existsSync(idx)) { console.warn('skip (no index):', slug); continue; }
    const text = readFileSync(idx, 'utf8').replace(/^﻿/, '');
    const { rawFM, body } = parseFM(text);
    if (!rawFM) { console.warn('skip (no fm):', slug); continue; }
    const hugoFM = buildHugoFM(rawFM);
    mkdirSync(dstDir, { recursive: true });
    // copy img dir if present
    const imgSrc = join(srcDir, 'img');
    if (existsSync(imgSrc)) cpSync(imgSrc, join(dstDir, 'img'), { recursive: true });
    // copy any other non-md asset files at the top level
    for (const n of readdirSync(srcDir)) {
      const p = join(srcDir, n);
      if (statSync(p).isFile() && n !== 'index.md') {
        cpSync(p, join(dstDir, n));
      }
    }
    writeFileSync(join(dstDir, 'index.md'), emitYAML(hugoFM) + body.replace(/^(```[a-zA-Z]+) +.+$/gm, '$1'));
    ok++;
  } catch (e) {
    console.error('FAIL', slug, e.message);
    fail++;
  }
}
console.log(`done: ${ok} ok, ${fail} failed, total ${slugs.length}`);
