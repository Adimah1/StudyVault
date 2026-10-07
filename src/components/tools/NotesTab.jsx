import { useEffect, useRef, useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Highlight from '@tiptap/extension-highlight';
import {
  Bold,
  Italic,
  Strikethrough,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Quote,
  Code,
  Highlighter,
  Undo2,
  Redo2,
} from 'lucide-react';
import { sv } from '../../lib/api';
import { escapeHtml } from '../../lib/format';

const SAVE_DELAY = 700;

export default function NotesTab({ fileId }) {
  const [status, setStatus] = useState('idle'); // idle | dirty | saving | saved | error
  const pendingHtml = useRef(null);
  const timer = useRef(null);
  const loaded = useRef(false);

  const save = async () => {
    clearTimeout(timer.current);
    timer.current = null;
    if (pendingHtml.current === null) return;
    const html = pendingHtml.current;
    pendingHtml.current = null;
    setStatus('saving');
    try {
      await sv.notes.save(fileId, html);
      setStatus('saved');
    } catch {
      setStatus('error');
    }
  };
  const saveRef = useRef(save);
  saveRef.current = save;

  const editor = useEditor({
    extensions: [
      StarterKit,
      Highlight,
      Placeholder.configure({ placeholder: 'Write your notes… Select text in the document and choose “Add to Notes” to quote it here.' }),
    ],
    editorProps: {
      attributes: { class: 'sv-prose prose prose-sm max-w-none px-5 py-4 focus:outline-none' },
    },
    onUpdate: ({ editor }) => {
      if (!loaded.current) return;
      pendingHtml.current = editor.isEmpty ? '' : editor.getHTML();
      setStatus('dirty');
      clearTimeout(timer.current);
      timer.current = setTimeout(() => saveRef.current(), SAVE_DELAY);
    },
  });

  // Load the note for this file.
  useEffect(() => {
    if (!editor) return;
    let alive = true;
    sv.notes.get(fileId).then((note) => {
      if (!alive || editor.isDestroyed) return;
      editor.commands.setContent(note?.content_html || '', false);
      loaded.current = true;
    });
    return () => {
      alive = false;
    };
  }, [editor, fileId]);

  // Flush unsaved changes when switching files / closing.
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      if (pendingHtml.current !== null) sv.notes.save(fileId, pendingHtml.current);
    },
    [fileId],
  );

  // "Add to Notes" from the document viewer.
  useEffect(() => {
    if (!editor) return;
    const onAppend = (e) => {
      const { fileId: target, text, page } = e.detail;
      if (target !== fileId) return;
      const paragraphs = text
        .split(/\n{2,}/)
        .map((p) => `<p>${escapeHtml(p).replace(/\n/g, ' ')}</p>`)
        .join('');
      const cite = page ? `<p><em>— page ${page}</em></p>` : '';
      editor
        .chain()
        .focus('end')
        .insertContent(`<blockquote>${paragraphs}${cite}</blockquote><p></p>`)
        .run();
    };
    window.addEventListener('sv:append-note', onAppend);
    return () => window.removeEventListener('sv:append-note', onAppend);
  }, [editor, fileId]);

  if (!editor) return null;

  const tools = [
    [Bold, 'Bold', () => editor.chain().focus().toggleBold().run(), editor.isActive('bold')],
    [Italic, 'Italic', () => editor.chain().focus().toggleItalic().run(), editor.isActive('italic')],
    [Strikethrough, 'Strikethrough', () => editor.chain().focus().toggleStrike().run(), editor.isActive('strike')],
    [Highlighter, 'Highlight', () => editor.chain().focus().toggleHighlight().run(), editor.isActive('highlight')],
    null,
    [Heading2, 'Heading', () => editor.chain().focus().toggleHeading({ level: 2 }).run(), editor.isActive('heading', { level: 2 })],
    [Heading3, 'Subheading', () => editor.chain().focus().toggleHeading({ level: 3 }).run(), editor.isActive('heading', { level: 3 })],
    [List, 'Bullet list', () => editor.chain().focus().toggleBulletList().run(), editor.isActive('bulletList')],
    [ListOrdered, 'Numbered list', () => editor.chain().focus().toggleOrderedList().run(), editor.isActive('orderedList')],
    [Quote, 'Quote', () => editor.chain().focus().toggleBlockquote().run(), editor.isActive('blockquote')],
    [Code, 'Code', () => editor.chain().focus().toggleCodeBlock().run(), editor.isActive('codeBlock')],
    null,
    [Undo2, 'Undo', () => editor.chain().focus().undo().run(), false],
    [Redo2, 'Redo', () => editor.chain().focus().redo().run(), false],
  ];

  const statusText = { idle: '', dirty: 'Unsaved', saving: 'Saving…', saved: 'Saved', error: 'Save failed' }[status];

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-0.5 border-b border-line px-2 py-1.5">
        {tools.map((t, i) =>
          t === null ? (
            <div key={i} className="mx-0.5 h-4 w-px bg-line" />
          ) : (
            <button
              key={t[1]}
              title={t[1]}
              aria-label={t[1]}
              onMouseDown={(e) => e.preventDefault()}
              onClick={t[2]}
              className={`grid h-7 w-[26px] place-items-center rounded ${t[3] ? 'bg-hover text-text' : 'text-muted hover:bg-hover hover:text-text'}`}
            >
              {(() => {
                const Icon = t[0];
                return <Icon size={14} />;
              })()}
            </button>
          ),
        )}
      </div>
      <div className="min-h-0 flex-1 cursor-text overflow-y-auto" onClick={() => editor.commands.focus()}>
        <EditorContent editor={editor} />
      </div>
      <div className="flex shrink-0 justify-between border-t border-line px-4 py-1.5 text-[11px] text-faint">
        <span>Saved locally with this file</span>
        <span className={status === 'error' ? 'text-danger' : ''}>{statusText}</span>
      </div>
    </div>
  );
}
