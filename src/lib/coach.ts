import { Chess, type Color, type Move } from 'chess.js';
import {
  formatEval,
  moverWin,
  THRESHOLDS,
  uciToSan,
  type Classification,
  type GameAnalysis,
} from './analysis';
import { hangingPieces, PIECE_NAME, PIECE_VALUE, uciMove } from './board';
import { MATE_CP } from './engine';

/** Plain-language reasons a move is good, based on the position it's played in. */
export function reasonsFor(fenBefore: string, uci: string): { move: Move | null; reasons: string[] } {
  const board = new Chess(fenBefore);
  const mover = board.turn();
  const opponent: Color = mover === 'w' ? 'b' : 'w';
  const hangingBefore = hangingPieces(board, mover);
  const opponentHangingBefore = hangingPieces(board, opponent);

  let move: Move;
  try {
    move = board.move(uciMove(uci));
  } catch {
    return { move: null, reasons: [] };
  }

  const reasons: string[] = [];

  if (board.isCheckmate()) reasons.push('Checkmates the opponent.');
  else if (board.inCheck()) reasons.push('Gives check, so the opponent has to respond.');

  if (move.captured) reasons.push(`Wins a ${PIECE_NAME[move.captured]} (worth ${PIECE_VALUE[move.captured]}).`);
  if (move.promotion) reasons.push(`Promotes to a ${PIECE_NAME[move.promotion]}.`);
  if (move.flags.includes('k') || move.flags.includes('q')) {
    reasons.push('Castles, getting the king to safety and connecting the rooks.');
  }

  const hangingAfter = hangingPieces(board, mover);
  for (const piece of hangingBefore) {
    const stillHanging = hangingAfter.some((h) => h.square === piece.square);
    if (piece.square === move.from && !hangingAfter.some((h) => h.square === move.to)) {
      reasons.push(`Moves the attacked ${PIECE_NAME[piece.piece]} out of danger.`);
    } else if (!stillHanging && piece.square !== move.from) {
      reasons.push(`Protects the ${PIECE_NAME[piece.piece]} on ${piece.square} that was under attack.`);
    }
  }

  for (const target of hangingPieces(board, opponent)) {
    if (!opponentHangingBefore.some((h) => h.square === target.square)) {
      reasons.push(`Attacks the undefended ${PIECE_NAME[target.piece]} on ${target.square}.`);
    }
  }

  if ((move.piece === 'n' || move.piece === 'b') && (move.from[1] === '1' || move.from[1] === '8')) {
    reasons.push(`Develops the ${PIECE_NAME[move.piece]} from the back rank.`);
  }
  if (move.piece === 'p' && ['d4', 'e4', 'd5', 'e5'].includes(move.to)) {
    reasons.push('Takes central space with a pawn.');
  }
  if (move.piece === 'n' && ['c4', 'c5', 'd4', 'd5', 'e4', 'e5', 'f4', 'f5'].includes(move.to)) {
    reasons.push(`Puts the knight on a strong central square (${move.to}).`);
  }

  if (reasons.length === 0) {
    reasons.push('No single tactic stands out; it is the engine’s preferred plan (see the line below).');
  }
  return { move, reasons };
}

/** Converts an engine line (UCI) to SAN, stopping at the first illegal move. */
export function lineToSan(fen: string, uciLine: string[], maxPlies = 6): string[] {
  const board = new Chess(fen);
  const san: string[] = [];
  for (const uci of uciLine.slice(0, maxPlies)) {
    try {
      san.push(board.move(uciMove(uci)).san);
    } catch {
      break;
    }
  }
  return san;
}

/** Numbers a SAN list the way it reads in a book: "12. Nf3 Nc6 13. Bb5". */
export function formatSanLine(fen: string, san: string[]): string {
  const [, side = 'w', , , , fullmove = '1'] = fen.split(' ');
  let moveNumber = Number(fullmove);
  let white = side === 'w';
  const parts: string[] = [];
  for (const move of san) {
    if (white) parts.push(`${moveNumber}. ${move}`);
    else parts.push(parts.length === 0 ? `${moveNumber}... ${move}` : move);
    if (!white) moveNumber++;
    white = !white;
  }
  return parts.join(' ');
}

const VERDICT: Record<Classification, string> = {
  brilliant: 'Brilliant — a real sacrifice that still works.',
  great: 'Great — the only move that holds.',
  best: 'Best move.',
  excellent: 'Excellent move.',
  good: 'Good move.',
  inaccuracy: 'Inaccuracy (dubious).',
  mistake: 'Mistake.',
  miss: 'Miss — a winning tactic was there.',
  blunder: 'Blunder.',
};

export type MoveCoaching = {
  index: number;
  label: string;
  classification: Classification;
  verdict: string;
  evalChange: string;
  /** What the played move got wrong (empty for good moves). */
  whatWentWrong: string[];
  /** Why the move stands out: brilliance, why it was the only move, or a missed tactic. */
  highlights: string[];
  /** The engine's suggestion and why it works; null when the played move was already best. */
  better: { san: string; reasons: string[]; line: string[] } | null;
  /** Set when the opponent erred on the previous move and this move didn't punish it. */
  missedTrap: string | null;
};

const sideName = (side: Color) => (side === 'w' ? 'White' : 'Black');

/** Builds the coaching notes for one move of the analysed game, for either side. */
export function coachMove(analysis: GameAnalysis, index: number, userColor: Color | null): MoveCoaching {
  const move = analysis.moves[index];
  const fenBefore = analysis.fens[index];
  const fenAfter = analysis.fens[index + 1];
  const mover = move.color;
  const opponent: Color = mover === 'w' ? 'b' : 'w';
  const moveNumber = Math.floor(index / 2) + 1;
  const label = `${moveNumber}${mover === 'w' ? '.' : '...'} ${move.san}`;
  const evalChange = `${formatEval(analysis.evals[index])} → ${formatEval(analysis.evals[index + 1])}`;
  const tag = (side: Color) => (userColor === side ? ' (you)' : '');

  const whatWentWrong: string[] = [];
  const highlights: string[] = [];
  const isBad = ['inaccuracy', 'mistake', 'miss', 'blunder'].includes(move.classification);

  const evalBefore = analysis.evals[index];
  const hadMate = mover === 'w' ? evalBefore >= MATE_CP - 1000 : evalBefore <= -(MATE_CP - 1000);
  if (hadMate && move.classification !== 'best' && move.classification !== 'brilliant') {
    whatWentWrong.push(`${sideName(mover)}${tag(mover)} had a forced mate (${formatEval(evalBefore)}) and missed it.`);
  }

  if (isBad) {
    const reply = analysis.bestMoves[index + 1];
    if (reply) {
      const replySan = uciToSan(fenAfter, reply);
      const replyBoard = new Chess(fenAfter);
      const replyMove = replyBoard.move(uciMove(reply));
      if (replyBoard.isCheckmate()) {
        whatWentWrong.push(`It allows checkmate: ${sideName(opponent)} answers ${replySan}#.`);
      } else if (replyMove.captured) {
        whatWentWrong.push(
          `${sideName(opponent)}'s best answer ${replySan} wins ${sideName(mover)}'s ${PIECE_NAME[replyMove.captured]} (worth ${PIECE_VALUE[replyMove.captured]}).`,
        );
      } else {
        whatWentWrong.push(
          `Loses about ${move.winLoss.toFixed(0)}% win chance. The engine prefers a different plan (see the line below).`,
        );
      }
    }
    for (const piece of hangingPieces(new Chess(fenAfter), mover)) {
      whatWentWrong.push(`${sideName(mover)}'s ${PIECE_NAME[piece.piece]} on ${piece.square} is left undefended and under attack.`);
    }
  }

  const bestUci = analysis.bestMoves[index];
  const bestReasons = bestUci ? reasonsFor(fenBefore, bestUci) : { move: null, reasons: [] };
  const bestSan = bestUci ? uciToSan(fenBefore, bestUci) : '';

  if (move.classification === 'brilliant') {
    highlights.push('The sacrificed piece can be taken, but the engine keeps this winning.');
  }
  if (move.classification === 'great') {
    const secondCp = analysis.secondEvals[index];
    if (secondCp !== null) {
      const gap = moverWin(analysis.evals[index], mover) - moverWin(secondCp, mover);
      highlights.push(`Only move: the next-best option is about ${gap.toFixed(0)}% worse in win chance.`);
    }
  }
  if (move.classification === 'blunder' && moverWin(analysis.evals[index], mover) >= 65 && moverWin(analysis.evals[index + 1], mover) < 50) {
    highlights.push('This turned a winning position into an equal or losing one.');
  }
  if (move.missedTactic && bestSan) {
    highlights.push(`Missed tactic: ${bestSan} — ${bestReasons.reasons[0]}`);
  }

  let better: MoveCoaching['better'] = null;
  if (isBad || move.classification === 'good' || move.missedTactic) {
    if (bestUci) {
      better = {
        san: bestSan,
        reasons: bestReasons.reasons,
        line: lineToSan(fenBefore, analysis.bestLines[index]),
      };
    }
  }

  let missedTrap: string | null = null;
  const previous = index > 0 ? analysis.moves[index - 1] : null;
  const opponentErred =
    previous !== null && previous.color !== mover && previous.winLoss >= THRESHOLDS.mistake;
  if (opponentErred && isBad && better) {
    missedTrap = `${sideName(previous.color)} played ${previous.san}, a ${previous.classification}. The punishment was ${better.san}; ${sideName(mover)} played ${move.san}.`;
  }

  return {
    index,
    label,
    classification: move.classification,
    verdict: VERDICT[move.classification],
    evalChange,
    whatWentWrong,
    highlights,
    better,
    missedTrap,
  };
}
