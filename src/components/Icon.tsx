import type { ReactNode } from 'react';

/*
 * Line icons drawn on a 24×24 grid with currentColor, so they take the text colour of the
 * button they sit in. Replaces emoji, which look different on every phone and can't be recoloured.
 */
const PATHS: Record<IconName, ReactNode> = {
  'sound-on': (
    <>
      <path d="M4 9h3l5-4v14l-5-4H4z" />
      <path d="M16 8.5a5 5 0 0 1 0 7" />
      <path d="M18.5 6a8.5 8.5 0 0 1 0 12" />
    </>
  ),
  'sound-off': (
    <>
      <path d="M4 9h3l5-4v14l-5-4H4z" />
      <path d="M16 9l5 6M21 9l-5 6" />
    </>
  ),
  first: (
    <>
      <path d="M6 5v14" />
      <path d="M18 6l-7 6 7 6z" />
    </>
  ),
  prev: <path d="M15 6l-6 6 6 6" />,
  next: <path d="M9 6l6 6-6 6" />,
  last: (
    <>
      <path d="M18 5v14" />
      <path d="M6 6l7 6-7 6z" />
    </>
  ),
  play: <path d="M8 5l11 7-11 7z" />,
  pause: (
    <>
      <path d="M8 5v14M16 5v14" />
    </>
  ),
  back: <path d="M15 5l-7 7 7 7" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  engine: (
    <>
      <rect x="7" y="7" width="10" height="10" rx="2" />
      <path d="M10 3v4M14 3v4M10 17v4M14 17v4M3 10h4M3 14h4M17 10h4M17 14h4" />
    </>
  ),
  moves: (
    <>
      <path d="M9 6h11M9 12h11M9 18h11" />
      <circle cx="4.5" cy="6" r="1" />
      <circle cx="4.5" cy="12" r="1" />
      <circle cx="4.5" cy="18" r="1" />
    </>
  ),
  coach: (
    <>
      <path d="M9 18h6M10 21h4" />
      <path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z" />
    </>
  ),
  stats: (
    <>
      <path d="M5 20V12M12 20V5M19 20v-8" />
    </>
  ),
  book: (
    <>
      <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z" />
      <path d="M4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5" />
    </>
  ),
  trainer: (
    <>
      <path d="M2 9l10-5 10 5-10 5z" />
      <path d="M6 11v5c0 1.5 2.7 3 6 3s6-1.5 6-3v-5" />
    </>
  ),
  practice: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 9h18M3 15h18M9 3v18M15 3v18" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6" />
      <path d="M20 20l-4.5-4.5" />
    </>
  ),
  chevron: <path d="M9 6l6 6-6 6" />,
};

export type IconName =
  | 'sound-on'
  | 'sound-off'
  | 'first'
  | 'prev'
  | 'next'
  | 'last'
  | 'play'
  | 'pause'
  | 'back'
  | 'close'
  | 'engine'
  | 'moves'
  | 'coach'
  | 'stats'
  | 'book'
  | 'trainer'
  | 'practice'
  | 'search'
  | 'chevron';

export function Icon({ name }: { name: IconName }) {
  return (
    <svg
      className="icon"
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
