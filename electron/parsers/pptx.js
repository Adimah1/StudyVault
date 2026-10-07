'use strict';

// The parser itself lives in shared/pptx.mjs (also used by the mobile app).
async function parsePptx(buffer) {
  const { parsePptx: parse } = await import('../../shared/pptx.mjs');
  return parse(buffer);
}

module.exports = { parsePptx };
