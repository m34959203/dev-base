'use client';

/**
 * RichTextEditor на TipTap с toolbar (B/I/U, headings, lists, link, image, align).
 *
 * Главный WYSIWYG-компонент админки til-kural. Перенесено и адаптировано из AIMAK
 * (apps/web/src/components/rich-text-editor.tsx ~900 LOC) с упрощением:
 *  - иконки заменены с react-icons на lucide-react (единый стиль с til-kural);
 *  - убраны хуки upload-media — вставка картинки через prompt(URL);
 *  - добавлен YouTube-embed (ResizableVideo) вместо полноценной video-загрузки;
 *  - desktop-only toolbar (без mobile bottom-sheet) для упрощения.
 *
 * Public API:
 *   <RichTextEditor
 *     value={html}
 *     onChange={setHtml}
 *     placeholder="Начните писать..."
 *     minHeight={200}
 *     disabled={false}
 *   />
 */

import React, { useCallback, useEffect, useRef } from 'react';
import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import TextAlign from '@tiptap/extension-text-align';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Quote,
  Code,
  Link as LinkIcon,
  Image as ImageIcon,
  Video as VideoIcon,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Undo,
  Redo,
} from 'lucide-react';

import { ResizableImage } from './editor/extensions/resizable-image';
import { ResizableVideo } from './editor/extensions/resizable-video';

/**
 * RichTextEditor — WYSIWYG на TipTap.
 * Адаптирован из AIMAK (apps/web/src/components/rich-text-editor.tsx),
 * упрощён и переведён на lucide-react иконки.
 */
export interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  minHeight?: number;
  disabled?: boolean;
}

interface ToolbarButtonProps {
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  title: string;
  children: React.ReactNode;
}

function ToolbarButton({ onClick, active, disabled, title, children }: ToolbarButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      aria-pressed={active}
      className={[
        'inline-flex items-center justify-center w-8 h-8 rounded transition-colors',
        active ? 'bg-teal-100 text-teal-700' : 'text-gray-700 hover:bg-gray-100',
        disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer',
      ].join(' ')}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <span className="w-px h-6 bg-gray-300 mx-1 self-center" aria-hidden="true" />;
}

function Toolbar({ editor }: { editor: Editor }) {
  const addLink = useCallback(() => {
    const prev = editor.getAttributes('link').href as string | undefined;
    const url = window.prompt('URL ссылки:', prev ?? 'https://');
    if (url === null) return; // cancelled
    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  }, [editor]);

  const addImage = useCallback(() => {
    const url = window.prompt('URL изображения:', 'https://');
    if (!url) return;
    editor.chain().focus().setImage({ src: url }).run();
  }, [editor]);

  const addVideo = useCallback(() => {
    const url = window.prompt('URL YouTube видео:', 'https://www.youtube.com/watch?v=');
    if (!url) return;
    editor.chain().focus().setResizableVideo({ src: url }).run();
  }, [editor]);

  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b border-gray-200 bg-gray-50 px-2 py-1.5 rounded-t-lg">
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBold().run()}
        active={editor.isActive('bold')}
        title="Жирный (Ctrl+B)"
      >
        <Bold className="w-4 h-4" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleItalic().run()}
        active={editor.isActive('italic')}
        title="Курсив (Ctrl+I)"
      >
        <Italic className="w-4 h-4" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleUnderline().run()}
        active={editor.isActive('underline')}
        title="Подчёркнутый (Ctrl+U)"
      >
        <UnderlineIcon className="w-4 h-4" />
      </ToolbarButton>

      <Divider />

      <ToolbarButton
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
        active={editor.isActive('heading', { level: 1 })}
        title="Заголовок 1"
      >
        <Heading1 className="w-4 h-4" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        active={editor.isActive('heading', { level: 2 })}
        title="Заголовок 2"
      >
        <Heading2 className="w-4 h-4" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        active={editor.isActive('heading', { level: 3 })}
        title="Заголовок 3"
      >
        <Heading3 className="w-4 h-4" />
      </ToolbarButton>

      <Divider />

      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        active={editor.isActive('bulletList')}
        title="Маркированный список"
      >
        <List className="w-4 h-4" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        active={editor.isActive('orderedList')}
        title="Нумерованный список"
      >
        <ListOrdered className="w-4 h-4" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        active={editor.isActive('blockquote')}
        title="Цитата"
      >
        <Quote className="w-4 h-4" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
        active={editor.isActive('codeBlock')}
        title="Блок кода"
      >
        <Code className="w-4 h-4" />
      </ToolbarButton>

      <Divider />

      <ToolbarButton
        onClick={addLink}
        active={editor.isActive('link')}
        title="Ссылка"
      >
        <LinkIcon className="w-4 h-4" />
      </ToolbarButton>
      <ToolbarButton onClick={addImage} title="Вставить изображение">
        <ImageIcon className="w-4 h-4" />
      </ToolbarButton>
      <ToolbarButton onClick={addVideo} title="Вставить YouTube видео">
        <VideoIcon className="w-4 h-4" />
      </ToolbarButton>

      <Divider />

      <ToolbarButton
        onClick={() => editor.chain().focus().setTextAlign('left').run()}
        active={editor.isActive({ textAlign: 'left' })}
        title="По левому краю"
      >
        <AlignLeft className="w-4 h-4" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().setTextAlign('center').run()}
        active={editor.isActive({ textAlign: 'center' })}
        title="По центру"
      >
        <AlignCenter className="w-4 h-4" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().setTextAlign('right').run()}
        active={editor.isActive({ textAlign: 'right' })}
        title="По правому краю"
      >
        <AlignRight className="w-4 h-4" />
      </ToolbarButton>

      <Divider />

      <ToolbarButton
        onClick={() => editor.chain().focus().undo().run()}
        disabled={!editor.can().undo()}
        title="Отменить (Ctrl+Z)"
      >
        <Undo className="w-4 h-4" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().redo().run()}
        disabled={!editor.can().redo()}
        title="Повторить (Ctrl+Y)"
      >
        <Redo className="w-4 h-4" />
      </ToolbarButton>
    </div>
  );
}

export function RichTextEditor({
  value,
  onChange,
  placeholder,
  minHeight = 200,
  disabled = false,
}: RichTextEditorProps) {
  const isUpdatingRef = useRef(false);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit,
      Underline,
      ResizableImage.configure({ allowBase64: true }),
      ResizableVideo,
      Placeholder.configure({
        placeholder: placeholder || 'Начните писать...',
      }),
      TextAlign.configure({
        types: ['heading', 'paragraph'],
      }),
      Link.configure({
        openOnClick: false,
        autolink: true,
        HTMLAttributes: {
          class: 'text-teal-600 underline hover:text-teal-800',
          rel: 'noopener noreferrer',
          target: '_blank',
        },
      }),
    ],
    content: value ?? '',
    editable: !disabled,
    onUpdate: ({ editor: ed }) => {
      if (isUpdatingRef.current) return;
      onChange(ed.getHTML());
    },
    editorProps: {
      attributes: {
        class: 'prose prose-sm max-w-none p-3 focus:outline-none',
        style: `min-height: ${minHeight}px`,
      },
    },
  });

  // Keep editor in sync when `value` prop changes externally
  useEffect(() => {
    if (!editor) return;
    const current = editor.getHTML();
    if (value === current) return;
    // Avoid redundant updates on every onUpdate roundtrip
    if (!value && current === '<p></p>') return;
    try {
      isUpdatingRef.current = true;
      editor.commands.setContent(value || '', { emitUpdate: false });
    } finally {
      setTimeout(() => {
        isUpdatingRef.current = false;
      }, 50);
    }
  }, [value, editor]);

  // Toggle editable when `disabled` prop changes
  useEffect(() => {
    if (!editor) return;
    editor.setEditable(!disabled);
  }, [disabled, editor]);

  // Destroy editor on unmount
  useEffect(() => {
    return () => {
      editor?.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!editor) {
    return (
      <div
        className="border border-gray-300 rounded-lg bg-white animate-pulse"
        style={{ minHeight: minHeight + 56 }}
      />
    );
  }

  const charCount = editor.storage?.characterCount?.characters?.() ?? editor.getText().length;

  return (
    <div className="border border-gray-300 rounded-lg overflow-hidden bg-white focus-within:border-teal-400 focus-within:ring-1 focus-within:ring-teal-200 transition-colors">
      <Toolbar editor={editor} />
      <EditorContent editor={editor} />
      <div className="flex justify-end border-t border-gray-100 bg-gray-50 px-3 py-1 text-[11px] text-gray-500">
        {charCount} символов
      </div>
    </div>
  );
}

export default RichTextEditor;
