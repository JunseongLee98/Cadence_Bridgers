'use client';

import { htmlToReadableText } from '@/lib/html-readable';

type Props = {
  html?: string | null;
  className?: string;
  /** Max height for scrollable body (Tailwind class). */
  maxHeightClassName?: string;
};

/**
 * Renders calendar/Canvas descriptions as readable plain text (no raw HTML tags).
 */
export default function ReadableDescription({
  html,
  className = '',
  maxHeightClassName = 'max-h-56',
}: Props) {
  const text = htmlToReadableText(html);
  if (!text) return null;

  return (
    <div
      className={`mt-2 rounded-md border border-gray-100 bg-gray-50 px-3 py-2 text-sm leading-relaxed text-gray-700 whitespace-pre-wrap break-words overflow-y-auto ${maxHeightClassName} ${className}`}
    >
      {text}
    </div>
  );
}
