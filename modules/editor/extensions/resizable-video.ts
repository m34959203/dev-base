'use client';

import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/core';
import React, { useState, useRef, useEffect, createElement as h } from 'react';

/**
 * ResizableVideo — простое расширение TipTap для вставки YouTube-видео.
 * Адаптировано из AIMAK (apps/web/src/components/extensions/resizable-video.tsx),
 * упрощено до YouTube-only через <iframe>. Без JSX, чтобы остаться в .ts.
 */

const getYouTubeVideoId = (url: string): string | null => {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/|youtube\.com\/shorts\/)([^&\n?#]+)/,
    /^([a-zA-Z0-9_-]{11})$/,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match && match[1]) return match[1];
  }
  return null;
};

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    resizableVideo: {
      /** Вставить YouTube-видео по URL */
      setResizableVideo: (options: { src: string; width?: number; height?: number }) => ReturnType;
    };
  }
}

const ResizableVideoComponent: React.FC<NodeViewProps> = ({ node, updateAttributes, selected }) => {
  const [isResizing, setIsResizing] = useState(false);
  const [resizeDirection, setResizeDirection] = useState<string>('');
  const containerRef = useRef<HTMLDivElement>(null);
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

    const container = containerRef.current;
    if (container) {
      startWidth.current = container.offsetWidth;
      startHeight.current = container.offsetHeight;
    }
  };

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return;
      const deltaX = e.clientX - startX.current;
      const deltaY = e.clientY - startY.current;

      let newWidth = startWidth.current;
      let newHeight = startHeight.current;

      if (resizeDirection.includes('e')) newWidth = startWidth.current + deltaX;
      else if (resizeDirection.includes('w')) newWidth = startWidth.current - deltaX;

      if (resizeDirection.includes('s')) newHeight = startHeight.current + deltaY;
      else if (resizeDirection.includes('n')) newHeight = startHeight.current - deltaY;

      if (resizeDirection.length === 2) {
        newHeight = (newWidth * 9) / 16;
      }

      newWidth = Math.max(200, newWidth);
      newHeight = Math.max(112, newHeight);

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

  const attrs = node.attrs as { src: string; width?: number | null; height?: number | null };
  const { src, width, height } = attrs;

  const videoId = getYouTubeVideoId(src || '');
  const embedSrc = videoId ? `https://www.youtube.com/embed/${videoId}` : src;

  const w = typeof width === 'number' && width > 0 ? width : 560;
  const hh = typeof height === 'number' && height > 0 ? height : Math.round((w * 9) / 16);

  const cornerHandle = (cursor: string, dir: string) =>
    h('span', {
      key: `h-${dir}`,
      className: `absolute w-3 h-3 bg-teal-500 border border-white cursor-${cursor}`,
      style: cornerStyle(dir),
      onMouseDown: (e: React.MouseEvent) => handleMouseDown(e, dir),
    });

  return h(
    NodeViewWrapper,
    { className: 'resizable-video-wrapper relative my-3', 'data-drag-handle': '' },
    h(
      'div',
      {
        ref: containerRef,
        className: `relative overflow-hidden rounded border-2 ${
          selected ? 'border-teal-500' : 'border-transparent'
        }`,
        style: { width: `${w}px`, height: `${hh}px`, maxWidth: '100%' },
      },
      embedSrc
        ? h('iframe', {
            src: embedSrc,
            width: w,
            height: hh,
            allow:
              'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture',
            allowFullScreen: true,
            className: 'w-full h-full',
          })
        : h(
            'div',
            {
              className:
                'flex items-center justify-center w-full h-full bg-gray-100 text-gray-500 text-sm',
            },
            'Нет URL видео',
          ),
      !selected
        ? h('span', { className: 'absolute inset-0 cursor-pointer', 'aria-hidden': 'true' })
        : null,
    ),
    selected
      ? [
          cornerHandle('nw-resize', 'nw'),
          cornerHandle('ne-resize', 'ne'),
          cornerHandle('sw-resize', 'sw'),
          cornerHandle('se-resize', 'se'),
          isResizing
            ? h(
                'span',
                {
                  key: 'tooltip',
                  className:
                    'absolute -bottom-7 left-1/2 -translate-x-1/2 bg-gray-800 text-white text-xs px-2 py-1 rounded',
                },
                `${w} × ${hh}`,
              )
            : null,
        ]
      : null,
  );
};

function cornerStyle(dir: string): React.CSSProperties {
  const base: React.CSSProperties = {};
  if (dir.includes('n')) { base.top = 0; base.transform = 'translate(-50%, -50%)'; }
  if (dir.includes('s')) { base.bottom = 0; base.transform = 'translate(-50%, 50%)'; }
  if (dir === 'nw' || dir === 'sw') base.left = 0;
  if (dir === 'ne' || dir === 'se') base.right = 0;
  if (dir === 'nw') base.transform = 'translate(-50%, -50%)';
  if (dir === 'ne') base.transform = 'translate(50%, -50%)';
  if (dir === 'sw') base.transform = 'translate(-50%, 50%)';
  if (dir === 'se') base.transform = 'translate(50%, 50%)';
  return base;
}

export const ResizableVideo = Node.create({
  name: 'resizableVideo',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      src: { default: '' },
      width: { default: 560 },
      height: { default: 315 },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-resizable-video]' }];
  },

  renderHTML({ HTMLAttributes }) {
    const raw = String(HTMLAttributes.src || '');
    const id = getYouTubeVideoId(raw);
    const embed = id ? `https://www.youtube.com/embed/${id}` : raw;
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-resizable-video': 'true' }),
      [
        'iframe',
        {
          src: embed,
          width: HTMLAttributes.width ?? 560,
          height: HTMLAttributes.height ?? 315,
          frameborder: '0',
          allow:
            'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture',
          allowfullscreen: 'true',
        },
      ],
    ];
  },

  addCommands() {
    return {
      setResizableVideo:
        (options) =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs: options,
          });
        },
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(ResizableVideoComponent);
  },
});

export default ResizableVideo;
