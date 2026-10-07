import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import DOMPurify from 'dompurify';
import { escapeHtml, searchTerms, termsRegExp } from '../../lib/format';

/** Wrap matches of the search terms in <mark class="sv-hit"> (text nodes only). */
function markTerms(root, terms) {
  root.querySelectorAll('mark.sv-hit').forEach((m) => m.replaceWith(document.createTextNode(m.textContent)));
  root.normalize();
  const re = termsRegExp(terms);
  if (!re) return;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);

  let count = 0;
  for (const node of nodes) {
    if (count > 300) break;
    const parts = node.nodeValue.split(re);
    if (parts.length < 2) continue;
    const frag = document.createDocumentFragment();
    parts.forEach((part, i) => {
      if (!part) return;
      if (i % 2) {
        const mark = document.createElement('mark');
        mark.className = 'sv-hit';
        mark.textContent = part;
        frag.appendChild(mark);
        count++;
      } else {
        frag.appendChild(document.createTextNode(part));
      }
    });
    node.replaceWith(frag);
  }
}

/** Renders DOCX (mammoth HTML), PPTX (slide HTML) and TXT as clean, readable pages. */
export default function HtmlViewer({ kind, ext, html, text, term, onLayoutReady }) {
  const ref = useRef(null);

  const safeHtml = useMemo(() => {
    if (kind === 'text') return `<pre class="not-prose whitespace-pre-wrap font-sans text-[15px] leading-7">${escapeHtml(text || '')}</pre>`;
    return DOMPurify.sanitize(html || '', { USE_PROFILES: { html: true } });
  }, [kind, html, text]);

  useLayoutEffect(() => {
    onLayoutReady(ref.current.querySelectorAll('[data-page]').length || 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [safeHtml]);

  useEffect(() => {
    markTerms(ref.current, searchTerms(term));
  }, [term, safeHtml]);

  const empty = !(kind === 'text' ? text : html)?.trim();

  return (
    <article
      ref={ref}
      className={`sv-prose prose mx-auto px-4 py-6 sm:px-10 sm:py-12${ext === 'pptx' ? 'max-w-4xl' : 'max-w-3xl'} prose-headings:tracking-tight prose-img:rounded-lg`}
    >
      {empty ? (
        <p className="text-muted">This document has no readable text content.</p>
      ) : (
        <div dangerouslySetInnerHTML={{ __html: safeHtml }} />
      )}
    </article>
  );
}
