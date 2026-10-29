import { Chess, type Square } from 'chess.js';
import type { CSSProperties } from 'react';

/**
 * Move hints for click-to-move: a dot on each empty square the selected piece can reach,
 * and a ring on each square it can capture on, the way chess.com shows them.
 */

const DOT = 'radial-gradient(circle, rgba(0, 0, 0, 0.28) 22%, transparent 24%)';
const RING = 'radial-gradient(circle, transparent 62%, rgba(0, 0, 0, 0.3) 64%, rgba(0, 0, 0, 0.3) 72%, transparent 74%)';

/** The same position with the given side to move (castling and en passant are ignored for hints). */
function fenWithSide(fen: string, side: 'w' | 'b'): string {
  const parts = fen.split(' ');
  parts[1] = side;
  parts[3] = '-';
  return parts.join(' ');
}

/** Squares the piece on `square` can legally move to, whichever side it belongs to. */
export function legalTargets(fen: string, square: string): { to: string; capture: boolean }[] {
  const board = new Chess(fen);
  const piece = board.get(square as Square);
  if (!piece) return [];
  try {
    const probe = piece.color === board.turn() ? board : new Chess(fenWithSide(fen, piece.color));
    return probe.moves({ square: square as Square, verbose: true }).map((move) => ({
      to: move.to,
      capture: Boolean(move.captured) || move.flags.includes('e'),
    }));
  } catch {
    return [];
  }
}

/** Square styles that draw the hints. Merged with any other highlights by the caller. */
export function hintStyles(fen: string, square: string | null): Record<string, CSSProperties> {
  const styles: Record<string, CSSProperties> = {};
  if (!square) return styles;
  for (const target of legalTargets(fen, square)) {
    styles[target.to] = { backgroundImage: target.capture ? RING : DOT };
  }
  return styles;
}
