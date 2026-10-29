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
 * Board square colours, set explicitly so they stay the same in dark mode. (Without this,
 * some phones' forced-dark settings recolour the squares.)
 */
export const BOARD_COLORS = { light: '#F0D9B5', dark: '#B58863' } as const;
