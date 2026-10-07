'use strict';

const mammoth = require('mammoth');

async function parseDocx(buffer) {
  const [{ value: html }, { value: text }] = await Promise.all([
    mammoth.convertToHtml({ buffer }),
    mammoth.extractRawText({ buffer }),
  ]);
  return { pages: [text], html };
}

module.exports = { parseDocx };
