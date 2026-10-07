'use strict';

// A .pptx file is a zip of XML parts. We read slides (in presentation order),
// their text, tables and speaker notes directly with JSZip, which is more
// reliable than the available npm "pptx parser" packages.
const JSZip = require('jszip');
const posix = require('path').posix;

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function decodeXml(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e) => {
    if (e[0] !== '#') return ENTITIES[e.toLowerCase()];
    const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return Number.isFinite(code) ? String.fromCodePoint(code) : '';
  });
}

function escapeHtml(s) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}
const htmlLines = (s) => escapeHtml(s).replace(/\n/g, '<br>');

/** Paragraphs (<a:p>) inside an XML fragment, with indent level. */
function paragraphs(xml) {
  const out = [];
  for (const m of xml.matchAll(/<a:p(?:\s[^>]*)?>([\s\S]*?)<\/a:p>/g)) {
    const inner = m[1];
    let text = '';
    for (const t of inner.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>|<a:br\b[^>]*\/?>/g)) {
      text += t[1] !== undefined ? decodeXml(t[1]) : '\n';
    }
    text = text.replace(/[ \t]+/g, ' ').trim();
    if (!text) continue;
    const lvl = /<a:pPr[^>]*\blvl="(\d+)"/.exec(inner);
    out.push({ text, level: lvl ? Math.min(4, Number(lvl[1])) : 0 });
  }
  return out;
}

function placeholderType(shapeXml) {
  const m = /<p:ph\b[^>]*\btype="([^"]+)"/.exec(shapeXml);
  return m ? m[1] : null;
}

function parseRels(xml) {
  const rels = [];
  for (const m of (xml || '').matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /\bId="([^"]+)"/.exec(m[0]);
    const target = /\bTarget="([^"]+)"/.exec(m[0]);
    const type = /\bType="([^"]+)"/.exec(m[0]);
    if (id && target) rels.push({ id: id[1], target: target[1], type: type ? type[1] : '' });
  }
  return rels;
}

function resolveTarget(baseDir, target) {
  return target.startsWith('/') ? target.slice(1) : posix.normalize(posix.join(baseDir, target));
}

async function readText(zip, name) {
  const f = zip.file(name);
  return f ? f.async('string') : null;
}

async function slidePaths(zip) {
  const pres = await readText(zip, 'ppt/presentation.xml');
  const rels = parseRels(await readText(zip, 'ppt/_rels/presentation.xml.rels'));
  if (pres && rels.length) {
    const byId = Object.fromEntries(rels.map((r) => [r.id, r.target]));
    const ordered = [...pres.matchAll(/<p:sldId\b[^>]*\br:id="([^"]+)"/g)]
      .map((m) => byId[m[1]])
      .filter(Boolean)
      .map((t) => resolveTarget('ppt', t))
      .filter((p) => zip.file(p));
    if (ordered.length) return ordered;
  }
  const num = (p) => Number(/slide(\d+)\.xml$/.exec(p)[1]);
  return Object.keys(zip.files)
    .filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f))
    .sort((a, b) => num(a) - num(b));
}

async function notesFor(zip, slidePath) {
  const dir = posix.dirname(slidePath);
  const relsXml = await readText(zip, `${dir}/_rels/${posix.basename(slidePath)}.rels`);
  const rel = parseRels(relsXml).find((r) => r.type.endsWith('/notesSlide'));
  if (!rel) return [];
  const xml = await readText(zip, resolveTarget(dir, rel.target));
  if (!xml) return [];
  const shapes = xml.match(/<p:sp(?:\s[^>]*)?>[\s\S]*?<\/p:sp>/g) || [];
  return shapes.filter((sp) => placeholderType(sp) === 'body').flatMap((sp) => paragraphs(sp).map((p) => p.text));
}

function tables(xml) {
  return (xml.match(/<a:tbl>[\s\S]*?<\/a:tbl>/g) || []).map((tbl) =>
    (tbl.match(/<a:tr\b[\s\S]*?<\/a:tr>/g) || []).map((tr) =>
      (tr.match(/<a:tc\b[\s\S]*?<\/a:tc>/g) || []).map((tc) => paragraphs(tc).map((p) => p.text).join('\n')),
    ),
  );
}

function parseSlide(xml) {
  let title = '';
  let subtitle = '';
  const body = [];
  for (const sp of xml.match(/<p:sp(?:\s[^>]*)?>[\s\S]*?<\/p:sp>/g) || []) {
    const type = placeholderType(sp);
    const paras = paragraphs(sp);
    if (!paras.length) continue;
    if ((type === 'title' || type === 'ctrTitle') && !title) title = paras.map((p) => p.text).join(' ');
    else if (type === 'subTitle' && !subtitle) subtitle = paras.map((p) => p.text).join(' ');
    else if (type === 'sldNum' || type === 'dt' || type === 'ftr') continue;
    else body.push(paras);
  }
  return { title, subtitle, body, tables: tables(xml) };
}

function renderSlide(n, slide, notes) {
  let h = `<section class="sv-slide" id="sv-page-${n}" data-page="${n}"><div class="sv-slide-num">Slide ${n}</div>`;
  if (slide.title) h += `<h2>${htmlLines(slide.title)}</h2>`;
  if (slide.subtitle) h += `<p class="sv-subtitle">${htmlLines(slide.subtitle)}</p>`;
  for (const paras of slide.body) {
    if (paras.length === 1 && paras[0].level === 0) h += `<p>${htmlLines(paras[0].text)}</p>`;
    else h += `<ul>${paras.map((p) => `<li class="lvl-${p.level}">${htmlLines(p.text)}</li>`).join('')}</ul>`;
  }
  for (const rows of slide.tables) {
    h += `<table><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${htmlLines(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  }
  if (notes.length) {
    h += `<div class="sv-notes"><div class="sv-notes-label">Speaker notes</div>${notes.map((t) => `<p>${htmlLines(t)}</p>`).join('')}</div>`;
  }
  return h + '</section>';
}

async function parsePptx(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const pages = [];
  let html = '';
  const paths = await slidePaths(zip);
  for (let i = 0; i < paths.length; i++) {
    const xml = await readText(zip, paths[i]);
    if (!xml) continue;
    const slide = parseSlide(xml);
    const notes = await notesFor(zip, paths[i]);
    const n = pages.length + 1;
    html += renderSlide(n, slide, notes);
    pages.push(
      [
        slide.title,
        slide.subtitle,
        ...slide.body.flat().map((p) => p.text),
        ...slide.tables.flat(2),
        notes.length ? `Notes: ${notes.join('\n')}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    );
  }
  return { pages, html };
}

module.exports = { parsePptx };
