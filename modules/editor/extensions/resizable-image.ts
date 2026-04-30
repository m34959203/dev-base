'use client';

import Image from '@tiptap/extension-image';
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/core';
import React, { useState, useRef, useEffect, createElement as h } from 'react';

/**
 * ResizableImage — расширение TipTap поверх стандартного Image.
 * Позволяет ресайзить вставленные картинки за угловые/боковые хэндлы.
 * Адаптировано из AIMAK (apps/web/src/components/extensions/resizable-image.tsx),
 * упрощено: убраны align/float-контролы, оставлен drag resize.
 * Файл — .ts (React.createElement), чтобы тулинг не требовал .tsx.
 */

const ResizableImageComponent: React.FC<NodeViewProps> = ({ node, updateAttributes, selected }) => {
  const [isResizing, setIsResizing] = useState(false);
  const [resizeDirection, setResizeDirection] = useState<string>('');
  const imgRef = useRef<HTMLImageElement>(null);
  const startX = useRef(0);
  const startY = useRef(0);
  const startWidth = useRef(0);
  const startHeight = useRef(0);

  const handleMouseDown = (e: React.MouseEvent, direction: string) => {
    e.preventDefault();
    e.stopPropagation();

    setIsResizing(true);
    setResizeDirection(direction);
    startX.current = e.clientX;
    startY.current = e.clientY;

    const img = imgRef.current;
    if (img) {
      startWidth.current = img.offsetWidth;
      startHeight.current = img.offsetHeight;
    }
  };

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!imgRef.current) return;

      const deltaX = e.clientX - startX.current;
      const deltaY = e.clientY - startY.current;

      let newWidth = startWidth.current;
      let newHeight = startHeight.current;

      if (resizeDirection.includes('e')) {
        newWidth = startWidth.current + deltaX;
      } else if (resizeDirection.includes('w')) {
        newWidth = startWidth.current - deltaX;
      }

      if (resizeDirection.includes('s')) {
        newHeight = startHeight.current + deltaY;
      } else if (resizeDirection.includes('n')) {
        newHeight = startHeight.current - deltaY;
      }

      if (resizeDirection.length === 2) {
        const aspectRatio = startWidth.current / Math.max(startHeight.current, 1);
        newHeight = newWidth / aspectRatio;
      }

      newWidth = Math.max(50, newWidth);
      newHeight = Math.max(50, newHeight);

      updateAttributes({
        width: Math.round(newWidth),
        height: Math.round(newHeight),
      });
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      setResizeDirection('');
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing, resizeDirection, updateAttributes]);

  const attrs = node.attrs as {
    src: string;
    alt?: string;
    title?: string;
    width?: number | string | null;
    height?: number | string | null;
  };
  const { src, alt, title, width, height } = attrs;

  const handle = (cursor: string, dir: string) =>
    h('span', {
      key: `h-${dir}`,
      className: `absolute w-3 h-3 bg-teal-500 border border-white cursor-${cursor}`,
      style: handleStyle(dir),
      onMouseDown: (e: React.MouseEvent) => handleMouseDown(e, dir),
    });

  return h(
    NodeViewWrapper,
    {
      className: 'resizable-image-wrapper group relative inline-block',
      'data-drag-handle': '',
    },
    h('img', {
      ref: imgRef,
      src,
      alt: alt ?? '',
      title: title ?? undefined,
      className: `max-w-full rounded border-2 ${
        selected ? 'border-teal-500' : 'border-transparent'
      } transition-all`,
      style: {
        width: width ? `${width}px` : 'auto',
        height: height ? `${height}px` : 'auto',
      },
    }),
    selected
      ? [
          handle('nw-resize', 'nw'),
          handle('ne-resize', 'ne'),
          handle('sw-resize', 'sw'),
          handle('se-resize', 'se'),
          handle('n-resize', 'n'),
          handle('s-resize', 's'),
          handle('w-resize', 'w'),
          handle('e-resize', 'e'),
          isResizing
            ? h(
                'span',
                {
                  key: 'tooltip',
                  className:
                    'absolute -bottom-7 left-1/2 -translate-x-1/2 bg-gray-800 text-white text-xs px-2 py-1 rounded whitespace-nowrap',
                },
                `${typeof width === 'number' ? width : 'auto'} × ${typeof height === 'number' ? height : 'auto'}`,
              )
            : null,
        ]
      : null,
  );
};

function handleStyle(dir: string): React.CSSProperties {
  // Position + translate for 8 handles
  const base: React.CSSProperties = {};
  if (dir.includes('n')) { base.top = 0; base.transform = (base.transform || '') + ' translateY(-50%)'; }
  if (dir.includes('s')) { base.bottom = 0; base.transform = (base.transform || '') + ' translateY(50%)'; }
  if (dir.includes('w')) { base.left = 0; base.transform = (base.transform || '') + ' translateX(-50%)'; }
  if (dir.includes('e')) { base.right = 0; base.transform = (base.transform || '') + ' translateX(50%)'; }
  if (dir === 'n' || dir === 's') { base.left = '50%'; base.transform = 'translateX(-50%) ' + (base.transform || ''); }
  if (dir === 'w' || dir === 'e') { base.top = '50%'; base.transform = 'translateY(-50%) ' + (base.transform || ''); }
  return base;
}

export const ResizableImage = Image.extend({
  name: 'resizableImage',

  inline: false,
  group: 'block',
  draggable: true,

  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        renderHTML: (attributes: { width?: number | string | null }) => {
          if (!attributes.width) return {};
          return { 'data-width': attributes.width, width: attributes.width };
        },
        parseHTML: (element: HTMLElement) =>
          element.getAttribute('data-width') || element.getAttribute('width') || null,
      },
      height: {
        default: null,
        renderHTML: (attributes: { height?: number | string | null }) => {
          if (!attributes.height) return {};
          return { 'data-height': attributes.height, height: attributes.height };
        },
        parseHTML: (element: HTMLElement) =>
          element.getAttribute('data-height') || element.getAttribute('height') || null,
      },
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(ResizableImageComponent);
  },
});

export default ResizableImage;
