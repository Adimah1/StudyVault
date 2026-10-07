// In-app file parsing for the mobile build (same output shape as electron/parsers).
import * as pdfjs from 'pdfjs-dist';
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import mammoth from 'mammoth/mammoth.browser.js';
import { extractPdfPages } from '../../shared/pdf-text.mjs';
import { parsePptx } from '../../shared/pptx.mjs';

pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;

export const SUPPORTED = ['pdf', 'docx', 'pptx', 'txt'];

/** @returns {Promise<{ pages: string[], html: string|null }>} */
export async function parseFile(ext, buffer) {
  switch (ext) {
    case 'pdf':
      // pdf.js transfers (detaches) the buffer it's given, so hand it a copy.
      return { pages: await extractPdfPages(pdfjs, new Uint8Array(buffer.slice(0))), html: null };
    case 'docx': {
      const [{ value: html }, { value: text }] = await Promise.all([
        mammoth.convertToHtml({ arrayBuffer: buffer }),
        mammoth.extractRawText({ arrayBuffer: buffer }),
      ]);
      return { pages: [text], html };
    }
    case 'pptx':
      return parsePptx(buffer);
    case 'txt':
      return { pages: [new TextDecoder('utf-8').decode(buffer).replace(/^﻿/, '')], html: null };
    default:
      throw new Error(`Unsupported file type: .${ext}`);
  }
}
