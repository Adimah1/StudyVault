'use strict';

// Text extraction uses the same modern pdf.js as the viewer (react-pdf). The legacy
// build is the one meant for Node; it and the shared extractor are ESM, so load lazily.
let modules = null;
function load() {
  if (!modules) {
    modules = Promise.all([import('pdfjs-dist/legacy/build/pdf.mjs'), import('../../shared/pdf-text.mjs')]);
  }
  return modules;
}

/** Extract text page by page so search results can link to a specific page. */
async function parsePdf(buffer) {
  const [pdfjs, { extractPdfPages }] = await load();
  return { pages: await extractPdfPages(pdfjs, new Uint8Array(buffer)), html: null };
}

module.exports = { parsePdf };
