// PDF text extraction, page by page, shared by desktop and mobile.
// The caller passes in its pdf.js module (Node legacy build on desktop, browser build on mobile).

export async function extractPdfPages(pdfjs, data) {
  const doc = await pdfjs.getDocument({
    data,
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    verbosity: 0,
  }).promise;

  const pages = [];
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      let text = '';
      for (const item of content.items) {
        if (typeof item.str !== 'string') continue;
        text += item.str;
        if (item.hasEOL) text += '\n';
        else if (item.str && !item.str.endsWith(' ')) text += ' ';
      }
      pages.push(text.replace(/[ \t]+\n/g, '\n').replace(/[ \t]{2,}/g, ' ').trim());
      page.cleanup();
    }
  } finally {
    await doc.destroy();
  }
  return pages;
}
