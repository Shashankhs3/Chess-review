import type { Chess, Color, PieceSymbol, Square } from 'chess.js';

export const PIECE_NAME: Record<PieceSymbol, string> = {
  p: 'pawn',
  n: 'knight',
  b: 'bishop',
  r: 'rook',
  q: 'queen',
  k: 'king',
};

export const PIECE_VALUE: Record<PieceSymbol, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

export type Hanging = { square: Square; piece: PieceSymbol };

/** Pieces of `color` that the opponent attacks and nothing of `color` defends. */
export function hangingPieces(board: Chess, color: Color): Hanging[] {
  const opponent: Color = color === 'w' ? 'b' : 'w';
  return board
    .board()
    .flat()
    .flatMap((cell) => {
      if (!cell || cell.color !== color || cell.type === 'k') return [];
      const attacked = board.isAttacked(cell.square, opponent);
      const defended = board.isAttacked(cell.square, color);
      return attacked && !defended ? [{ square: cell.square, piece: cell.type }] : [];
    });
}

/** Splits a UCI move ("e2e4", "e7e8q") into the object chess.js expects. */
export function uciMove(uci: string) {
  return {
    from: uci.slice(0, 2) as Square,
    to: uci.slice(2, 4) as Square,
    promotion: uci.length > 4 ? (uci[4] as PieceSymbol) : undefined,
  };
}
