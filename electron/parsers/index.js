'use strict';

const fsp = require('fs/promises');
const { parsePdf } = require('./pdf');
const { parseDocx } = require('./docx');
const { parsePptx } = require('./pptx');

const SUPPORTED_EXTENSIONS = new Set(['pdf', 'docx', 'pptx', 'txt']);

/**
 * Every parser returns:
 *   pages: string[]     plain text per page/slide (used for search + AI)
 *   html:  string|null  pre-rendered HTML for the viewer (docx/pptx only)
 */
async function parseFile(filePath, ext) {
  const buffer = await fsp.readFile(filePath);
  switch (ext) {
    case 'pdf':
      return parsePdf(buffer);
    case 'docx':
      return parseDocx(buffer);
    case 'pptx':
      return parsePptx(buffer);
    case 'txt':
      return { pages: [buffer.toString('utf8').replace(/^﻿/, '')], html: null };
    default:
      throw new Error(`Unsupported file type: .${ext}`);
  }
}

module.exports = { parseFile, SUPPORTED_EXTENSIONS };
