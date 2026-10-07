import { useEffect, useMemo, useRef, useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/TextLayer.css';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { sv, errorMessage } from '../../lib/api';
import { escapeHtml, searchTerms, termsRegExp } from '../../lib/format';
import { Spinner } from '../ui.jsx';

pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;

const PDF_OPTIONS = { isEvalSupported: false };

/** Only pages near the viewport are rendered; the rest are sized placeholders. */
function LazyPage({ pageNumber, width, estHeight, scrollRef, textRenderer }) {
  const ref = useRef(null);
  const [visible, setVisible] = useState(pageNumber <= 2);

  useEffect(() => {
    const io = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), {
      root: scrollRef.current,
      rootMargin: '1200px 0px',
    });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [scrollRef]);

  return (
    <div
      ref={ref}
      data-page={pageNumber}
      className="relative mx-auto mb-6 overflow-hidden rounded-sm bg-white shadow-[0_2px_12px_rgba(0,0,0,0.35)]"
      style={{ width, minHeight: estHeight }}
    >
      {visible && (
        <Page
          pageNumber={pageNumber}
          width={width}
          renderAnnotationLayer={false}
          customTextRenderer={textRenderer}
          loading=""
        />
      )}
    </div>
  );
}

export default function PdfViewer({ fileId, width, zoom, dim, term, scrollRef, onLayoutReady }) {
  const [url, setUrl] = useState(null);
  const [error, setError] = useState(null);
  const [numPages, setNumPages] = useState(0);
  const [ratio, setRatio] = useState(null);

  // Load bytes over IPC and hand react-pdf a blob URL (avoids file:// access from the renderer).
  useEffect(() => {
    let alive = true;
    let objectUrl = null;
    sv.file
      .readBinary(fileId)
      .then((bytes) => {
        if (!alive) return;
        objectUrl = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
        setUrl(objectUrl);
      })
      .catch((e) => alive && setError(errorMessage(e)));
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [fileId]);

  const onLoadSuccess = async (pdf) => {
    const first = await pdf.getPage(1);
    const vp = first.getViewport({ scale: 1 });
    setRatio(vp.height / vp.width);
    setNumPages(pdf.numPages);
  };

  useEffect(() => {
    if (numPages && ratio) onLayoutReady(numPages);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numPages, ratio]);

  // Highlight search terms inside the PDF text layer.
  const textRenderer = useMemo(() => {
    const re = termsRegExp(searchTerms(term));
    if (!re) return undefined;
    return ({ str }) =>
      str
        .split(re)
        .map((part, i) => (i % 2 ? `<mark>${escapeHtml(part)}</mark>` : escapeHtml(part)))
        .join('');
  }, [term]);

  if (error) return <div className="py-20 text-center text-sm text-danger">{error}</div>;
  if (!url)
    return (
      <div className="grid place-items-center py-20 text-muted">
        <Spinner size={20} />
      </div>
    );

  const pageWidth = Math.round(Math.max(320, Math.min(width - 64, 960) * zoom));

  return (
    <Document
      file={url}
      options={PDF_OPTIONS}
      onLoadSuccess={onLoadSuccess}
      onLoadError={(e) => setError(`Could not open PDF: ${e.message}`)}
      loading={
        <div className="grid place-items-center py-20 text-muted">
          <Spinner size={20} />
        </div>
      }
      className={dim ? 'sv-dim' : ''}
    >
      {numPages > 0 &&
        ratio &&
        Array.from({ length: numPages }, (_, i) => (
          <LazyPage
            key={i}
            pageNumber={i + 1}
            width={pageWidth}
            estHeight={Math.round(pageWidth * ratio)}
            scrollRef={scrollRef}
            textRenderer={textRenderer}
          />
        ))}
    </Document>
  );
}
