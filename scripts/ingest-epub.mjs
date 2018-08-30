import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const defaultInput = '/Users/lty/Downloads/資治通鑑（典藏本）繁體豎排294卷全 胡三省註-.epub';
const input = resolve(process.argv[2] || defaultInput);
const outputRoot = resolve(process.argv[3] || resolve(projectRoot, 'public/book'));

function readZipEntry(entry) {
  return execFileSync('unzip', ['-p', input, entry], { encoding: 'utf8' });
}

function readZipBuffer(entry) {
  return execFileSync('unzip', ['-p', input, entry]);
}

function decodeEntities(value) {
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (_, entity) => {
    if (entity.toLowerCase() === 'amp') return '&';
    if (entity.toLowerCase() === 'lt') return '<';
    if (entity.toLowerCase() === 'gt') return '>';
    if (entity.toLowerCase() === 'quot') return '"';
    if (entity.toLowerCase() === 'apos') return "'";
    if (entity.toLowerCase() === 'nbsp') return ' ';
    const codePoint = entity.toLowerCase().startsWith('#x')
      ? Number.parseInt(entity.slice(2), 16)
      : Number.parseInt(entity.slice(1), 10);
    return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : '';
  });
}

function escapeHtml(value) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function normalizeText(value) {
  return decodeEntities(value).replace(/\s+/g, ' ').trim();
}

function classFromOpeningTag(tag) {
  const match = tag.match(/\bclass=["']([^"']+)["']/i);
  return match ? match[1].trim() : '';
}

function classKind(className) {
  const name = className.split(/\s+/)[0];
  if (name === 'note5') return 'collation';
  if (name === 'note') return 'note';
  if (name === 'name') return 'person';
  if (name === 'name1') return 'place';
  if (name === 'book-title') return 'book';
  if (name === 'reign-title') return 'year';
  if (name === 'number') return 'number';
  return null;
}

function parseInline(fragment, blockId, state) {
  const root = { tag: 'root', className: '', children: [] };
  const stack = [root];
  const tokenPattern = /<!--[\s\S]*?-->|<\/?(?:span|b)\b[^>]*>|<img\b[^>]*>|<br\s*\/?\s*>|[^<]+/gi;

  for (const token of fragment.match(tokenPattern) || []) {
    if (token.startsWith('<!--')) continue;
    if (/^<br/i.test(token)) {
      stack.at(-1).children.push({ tag: 'br', className: '', children: [] });
      continue;
    }
    if (/^<img/i.test(token)) {
      const src = token.match(/\bsrc=["']([^"']+)["']/i)?.[1] || '';
      const alt = token.match(/\balt=["']([^"']*)["']/i)?.[1] || '';
      stack.at(-1).children.push({ tag: 'img', className: classFromOpeningTag(token), src: basename(src), alt: decodeEntities(alt), children: [] });
      continue;
    }
    if (/^<\//.test(token)) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    if (/^<span/i.test(token)) {
      const node = { tag: 'span', className: classFromOpeningTag(token), children: [] };
      stack.at(-1).children.push(node);
      stack.push(node);
      continue;
    }
    if (/^<b/i.test(token)) {
      const node = { tag: 'strong', className: '', children: [] };
      stack.at(-1).children.push(node);
      stack.push(node);
      continue;
    }
    stack.at(-1).children.push({ tag: 'text', className: '', text: decodeEntities(token), children: [] });
  }

  const render = (node) => {
    if (node.tag === 'text') return escapeHtml(node.text);
    if (node.tag === 'br') return '<br />';
    if (node.tag === 'img') {
      return '<img class="source-glyph" src="/book/assets/' + escapeHtml(node.src) + '" alt="' + escapeHtml(node.alt) + '" aria-label="原書罕見字字圖" />';
    }
    const inner = node.children.map(render).join('');
    if (node.tag === 'strong') return `<strong>${inner}</strong>`;
    const kind = classKind(node.className);
    if (!kind) return inner;
    if (kind === 'note' || kind === 'collation') {
      const noteId = `${blockId}-n${String(state.noteCount++).padStart(2, '0')}`;
      state.notes.push({ id: noteId, kind, text: normalizeText(node.children.map(textContent).join('')), html: inner });
      const label = kind === 'collation' ? '校' : '注';
      const layerName = kind === 'collation' ? 'collation' : 'hu';
      return `<span class="source-note source-note-${layerName}" data-note-id="${noteId}"><span class="source-note-marker">${label}</span><span class="source-note-text">${inner}</span></span>`;
    }
    return `<span class="source-${kind}">${inner}</span>`;
  };

  const textContent = (node) => {
    if (node.tag === 'text') return node.text;
    if (node.tag === 'img') return node.alt;
    return node.children.map(textContent).join('');
  };

  return { html: root.children.map(render).join(''), text: normalizeText(root.children.map(textContent).join('')) };
}

function extractBlocks(source, sourceName) {
  const blocks = [];
  const sourcePattern = /<(h1|h2|p)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi;
  let match;
  let index = 1;
  while ((match = sourcePattern.exec(source))) {
    const openingTag = match[0].slice(0, match[0].indexOf('>') + 1);
    const className = classFromOpeningTag(openingTag);
    const id = `${sourceName.replace(/\.html$/i, '')}-p${String(index++).padStart(5, '0')}`;
    const state = { noteCount: 1, notes: [] };
    const inline = parseInline(match[2], id, state);
    const type = className === 'origin'
      ? 'body'
      : className === 'comment'
        ? 'commentary'
        : className === 'reign-title'
          ? 'year'
          : className === 'note1'
            ? 'note'
            : className === 'note5'
              ? 'collation'
              : match[1].toLowerCase();
    blocks.push({ id, type, className, text: inline.text, html: inline.html, notes: state.notes, source: sourceName });
  }
  return blocks;
}

function extractTitle(blocks, fallback) {
  const heading = blocks.find((block) => block.type === 'h1' || block.type === 'h2');
  return heading?.text || fallback;
}

const entries = execFileSync('unzip', ['-Z1', input], { encoding: 'utf8' })
  .split(/\r?\n/)
  .filter(Boolean);
const textEntries = entries.filter((entry) => /^OEBPS\/text\d+\.html$/i.test(entry));
const imageEntries = entries.filter((entry) => /^OEBPS\/Image\d+\.(?:gif|jpe?g|png)$/i.test(entry));
const opf = readZipEntry('OEBPS/content.opf');
const titleMatch = opf.match(/<dc:title>([\s\S]*?)<\/dc:title>/i);
const bookTitle = normalizeText(titleMatch ? titleMatch[1] : '資治通鑑');
const volumes = [];
const appendices = [];
const searchRecords = [];
let totalBlocks = 0;
let totalNotes = 0;

mkdirSync(resolve(outputRoot, 'volumes'), { recursive: true });
mkdirSync(resolve(outputRoot, 'appendices'), { recursive: true });
mkdirSync(resolve(outputRoot, 'assets'), { recursive: true });
for (const entry of imageEntries) {
  writeFileSync(resolve(outputRoot, 'assets', basename(entry)), readZipBuffer(entry));
}

for (const entry of textEntries) {
  const source = readZipEntry(entry);
  const blocks = extractBlocks(source, entry.split('/').at(-1));
  const title = extractTitle(blocks, '');
  if (!title.includes('資治通鑑卷')) {
    if (!title || title.replace(/\s/g, '') === '目錄') continue;
    const id = 'appendix-' + entry.match(/text(\d+)\.html/i)?.[1];
    const appendix = { id, kind: 'appendix', title, source: entry, blocks };
    writeFileSync(resolve(outputRoot, 'appendices', id + '.json'), JSON.stringify(appendix) + '\n');
    appendices.push({ id, title, source: entry, path: '/book/appendices/' + id + '.json', blockCount: blocks.length });
    totalBlocks += blocks.length;
    for (const block of blocks) {
      totalNotes += block.notes.length;
      if (block.text) searchRecords.push({ id: block.id, volumeId: id, title, type: block.type, text: block.text });
    }
    continue;
  }
  const ordinal = volumes.length + 1;
  const id = String(ordinal).padStart(3, '0');
  const volume = {
    id,
    ordinal,
    title,
    source: entry,
    blocks,
  };
  writeFileSync(resolve(outputRoot, 'volumes', `${id}.json`), `${JSON.stringify(volume)}\n`);
  volumes.push({ id, ordinal, title, source: entry, path: `/book/volumes/${id}.json`, blockCount: blocks.length });
  totalBlocks += blocks.length;
  for (const block of blocks) {
    totalNotes += block.notes.length;
    if (block.text) searchRecords.push({ id: block.id, volumeId: id, title, type: block.type, text: block.text });
  }
}

const manifest = {
  title: bookTitle,
  language: 'zh-Hant',
  volumeCount: volumes.length,
  volumes,
  appendices,
  generatedFrom: input,
  counts: { blocks: totalBlocks, notes: totalNotes, searchRecords: searchRecords.length },
};
writeFileSync(resolve(outputRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
writeFileSync(resolve(outputRoot, 'search.json'), `${JSON.stringify(searchRecords)}\n`);
writeFileSync(resolve(outputRoot, 'status.json'), `${JSON.stringify({ generatedAt: new Date().toISOString(), ...manifest.counts })}\n`);

console.log(`Generated ${volumes.length} volumes, ${totalBlocks} blocks, ${totalNotes} notes.`);
