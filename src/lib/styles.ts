import type { Classification } from './analysis';

export const LABELS: Record<Classification, string> = {
  brilliant: 'Brilliant',
  great: 'Great',
  best: 'Best',
  excellent: 'Excellent',
  good: 'Good',
  inaccuracy: 'Inaccuracy',
  mistake: 'Mistake',
  miss: 'Miss',
  blunder: 'Blunder',
};

export const COLORS: Record<Classification, string> = {
  brilliant: '#26c2a3',
  great: '#5c8bb0',
  best: '#81b64c',
  excellent: '#96bc4b',
  good: '#97a3ad',
  inaccuracy: '#f7c631',
  mistake: '#ffa459',
  miss: '#d6589f',
  blunder: '#fa412d',
};

/**
 * Darker versions of COLORS for text on the light theme. The fills are too faint to read as
 * numbers on white or cream (yellow and grey especially), so text uses these instead.
 */
export const TEXT_COLORS: Record<Classification, string> = {
  brilliant: '#0f7a65',
  great: '#3d6a8f',
  best: '#4f7d27',
  excellent: '#5f7f1e',
  good: '#5f6b75',
  inaccuracy: '#8a6a00',
  mistake: '#a4510a',
  miss: '#a3336f',
  blunder: '#c0392b',
};

/**
 * Board square colours, set explicitly so they stay the same in dark mode. (Without this,
 * some phones' forced-dark settings recolour the squares.)
 */
export const BOARD_COLORS = { light: '#F0D9B5', dark: '#B58863' } as const;
