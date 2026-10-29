import { Chess, type Color } from 'chess.js';
import { hangingPieces, PIECE_VALUE, uciMove } from './board';
import { MATE_CP, type StockfishEngine } from './engine';

export type { Color };

/**
 * brilliant: the best move is a sacrifice that still keeps the advantage.
 * great:     the best move is (nearly) the only good one.
 * best / excellent / good: fine moves, by how little win chance they give up.
 * inaccuracy (?!), mistake (?), blunder (??): the usual errors.
 * miss: the engine's best move was a tactic (capture, check, promotion) that was missed.
 */
export type Classification =
  | 'brilliant'
  | 'great'
  | 'best'
  | 'excellent'
  | 'good'
  | 'inaccuracy'
  | 'mistake'
  | 'miss'
  | 'blunder';

export type AnalyzedMove = {
  color: Color;
  san: string;
  uci: string;
  /** Engine's best move (UCI) in the position before this move. */
  bestMove: string;
  /** Win-% the mover gave away (0 when the move was as good as the engine's). */
  winLoss: number;
  accuracy: number;
  classification: Classification;
  /** The engine's best move was a capture, check or promotion that this move missed. */
  missedTactic: boolean;
};

export type GameAnalysis = {
  /** FEN before each ply; length = moves.length + 1. */
  fens: string[];
  /** White-POV centipawn eval for each FEN in `fens`. */
  evals: number[];
  /** White-POV eval of the second-best line for each FEN (null if only one legal move). */
  secondEvals: (number | null)[];
  /** Engine best move (UCI) for each FEN in `fens` ('' when the game is over). */
  bestMoves: string[];
  /** Engine principal variation (UCI) for each FEN in `fens`. */
  bestLines: string[][];
  moves: AnalyzedMove[];
  accuracy: Record<Color, number | null>;
  depth: number;
};

/**
 * Heuristic thresholds, measured in win-% lost by the mover.
 * These are our own tunable numbers, not chess.com's proprietary ones.
 */
export const THRESHOLDS = {
  // Bands from chess.com's published expected-points scale, read as win-% points.
  excellent: 2,
  good: 5,
  inaccuracy: 5,
  mistake: 10,
  blunder: 20,
  // A missed tactic only counts as a "miss" when the best move was worth at least this much.
  miss: 10,
  /** Best move is "great" when the second-best line is this many win-% worse. */
  great: 25,
  /** Brilliant sacrifices need the mover to be at least this good before the move... */
  brilliantBefore: 50,
  /** ...and still at least this good after it. */
  brilliantWin: 60,
  /** Net material given up (moved piece minus capture) for a move to count as a sacrifice. */
  sacrificeNet: 3,
} as const;

/** Win probability (0–100) from White's point of view, Lichess-style logistic. */
export function winPercent(cp: number): number {
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
}

/** Win probability (0–100) from the given side's point of view. */
export function moverWin(cp: number, side: Color): number {
  const white = winPercent(cp);
  return side === 'w' ? white : 100 - white;
}

/** Per-move accuracy from win-% lost (Lichess's curve). 100 = no loss. */
export function moveAccuracy(winLoss: number): number {
  const value = 103.1668 * Math.exp(-0.04354 * winLoss) - 3.1669;
  return Math.min(100, Math.max(0, value));
}

function classify(
  winLoss: number,
  isBest: boolean,
  isGreat: boolean,
  isBrilliant: boolean,
  isMiss: boolean,
): Classification {
  if (isBest) {
    if (isBrilliant) return 'brilliant';
    if (isGreat) return 'great';
    return 'best';
  }
  if (winLoss >= THRESHOLDS.blunder) return 'blunder';
  if (isMiss) return 'miss';
  if (winLoss >= THRESHOLDS.mistake) return 'mistake';
  if (winLoss >= THRESHOLDS.inaccuracy) return 'inaccuracy';
  if (winLoss >= THRESHOLDS.excellent) return 'good';
  return 'excellent';
}

/** Terminal positions are scored without the engine. */
async function evaluatePosition(
  engine: StockfishEngine,
  fen: string,
  depth: number,
): Promise<{ cp: number; bestMove: string; pv: string[]; secondCp: number | null }> {
  const position = new Chess(fen);
  if (position.isCheckmate()) {
    // Side to move is mated.
    return { cp: position.turn() === 'w' ? -MATE_CP : MATE_CP, bestMove: '', pv: [], secondCp: null };
  }
  if (position.isGameOver()) return { cp: 0, bestMove: '', pv: [], secondCp: null };

  const result = await engine.evaluate(fen, depth);
  return { cp: result.cp, bestMove: result.bestMove, pv: result.pv, secondCp: result.secondCp };
}

/** Whether a move captures, checks, promotes or mates. */
function isTacticalMove(fen: string, uci: string): boolean {
  const board = new Chess(fen);
  try {
    const move = board.move(uciMove(uci));
    return Boolean(move.captured || move.promotion || board.inCheck());
  } catch {
    return false;
  }
}

/**
 * Analyses every position in a game. Calls `onProgress` after each position and
 * returns `null` if `isCancelled()` becomes true part-way through.
 */
export async function analyzeGame(
  pgn: string,
  engines: StockfishEngine[],
  options: {
    depth: number;
    onProgress?: (done: number, total: number) => void;
    /** Called with how many positions, counted from the start, are analysed in a row. */
    onPrefix?: (analysedInOrder: number) => void;
    isCancelled?: () => boolean;
  },
): Promise<GameAnalysis | null> {
  const parsed = new Chess();
  parsed.loadPgn(pgn);
  const history = parsed.history({ verbose: true });
  const startFen = parsed.getHeaders().FEN;

  // Replay the game to get the FEN before every ply.
  const board = new Chess(startFen);
  const fens: string[] = [board.fen()];
  for (const move of history) {
    board.move(move.san);
    fens.push(board.fen());
  }

  // Positions are independent, so spread them over the engine pool: each engine
  // works through every n-th position, one at a time.
  const results: Awaited<ReturnType<typeof evaluatePosition>>[] = new Array(fens.length);
  const finished: boolean[] = new Array(fens.length).fill(false);
  let inOrder = 0; // positions 0..inOrder-1 are all finished
  let done = 0;
  const lanes = engines.map(async (engine, lane) => {
    for (let i = lane; i < fens.length; i += engines.length) {
      if (options.isCancelled?.()) return;
      results[i] = await evaluatePosition(engine, fens[i], options.depth);
      finished[i] = true;
      done++;
      options.onProgress?.(done, fens.length);
      while (inOrder < fens.length && finished[inOrder]) inOrder++;
      options.onPrefix?.(inOrder);
    }
  });
  await Promise.all(lanes);
  if (options.isCancelled?.()) return null;

  const evals = results.map((r) => r.cp);
  const secondEvals = results.map((r) => r.secondCp);
  const bestMoves = results.map((r) => r.bestMove);
  const bestLines = results.map((r) => r.pv);

  const moves: AnalyzedMove[] = history.map((move, i) => {
    const uci = `${move.from}${move.to}${move.promotion ?? ''}`;
    const isBest = uci === bestMoves[i];
    const before = winPercent(evals[i]);
    const after = winPercent(evals[i + 1]);
    // The engine's top move loses nothing by definition; the post-move eval comes from a
    // separate search, so its noise would otherwise show a loss on a "best" move.
    const winLoss = isBest
      ? 0
      : Math.max(0, move.color === 'w' ? before - after : after - before);

    const secondCp = secondEvals[i];
    const isGreat =
      isBest &&
      secondCp !== null &&
      moverWin(evals[i], move.color) - moverWin(secondCp, move.color) >= THRESHOLDS.great;

    // A real sacrifice: the best move gives up at least two points of material (the moved
    // piece hangs and the capture, if any, does not make up for it), while the mover is
    // already doing well and still has a clear edge afterwards.
    const movedValue = move.piece === 'p' ? 1 : PIECE_VALUE[move.piece];
    const capturedValue = move.captured ? PIECE_VALUE[move.captured] : 0;
    const isBrilliant =
      isBest &&
      movedValue - capturedValue >= THRESHOLDS.sacrificeNet &&
      hangingPieces(new Chess(fens[i + 1]), move.color).some((h) => h.square === uci.slice(2, 4)) &&
      moverWin(evals[i], move.color) >= THRESHOLDS.brilliantBefore &&
      moverWin(evals[i + 1], move.color) >= THRESHOLDS.brilliantWin;

    const bestIsTactical = !isBest && bestMoves[i] !== '' && isTacticalMove(fens[i], bestMoves[i]);
    const isMiss = bestIsTactical && winLoss >= THRESHOLDS.miss;

    return {
      color: move.color,
      san: move.san,
      uci,
      bestMove: bestMoves[i],
      winLoss,
      accuracy: moveAccuracy(winLoss),
      classification: classify(winLoss, isBest, isGreat, isBrilliant, isMiss),
      missedTactic: isMiss,
    };
  });

  const average = (color: Color): number | null => {
    const mine = moves.filter((m) => m.color === color);
    if (mine.length === 0) return null;
    return mine.reduce((sum, m) => sum + m.accuracy, 0) / mine.length;
  };

  return {
    fens,
    evals,
    secondEvals,
    bestMoves,
    bestLines,
    moves,
    accuracy: { w: average('w'), b: average('b') },
    depth: options.depth,
  };
}

/** Converts a UCI move in `fen` to SAN, or returns the raw UCI if it is illegal there. */
export function uciToSan(fen: string, uci: string): string {
  if (!uci) return '';
  try {
    return new Chess(fen).move(uciMove(uci)).san;
  } catch {
    return uci;
  }
}

/** "+1.25", "-0.40", or "M3" / "-M2" for forced mates. */
export function formatEval(cp: number): string {
  if (Math.abs(cp) >= MATE_CP - 1000) {
    const distance = MATE_CP - Math.abs(cp);
    return `${cp > 0 ? '' : '-'}M${distance}`;
  }
  const pawns = cp / 100;
  return `${pawns > 0 ? '+' : ''}${pawns.toFixed(2)}`;
}

/** Symbol shown next to a move. Routine moves (best, good) get none. */
export const SYMBOLS: Record<Classification, string> = {
  brilliant: '!!',
  great: '!',
  best: '',
  excellent: '',
  good: '',
  inaccuracy: '?!',
  mistake: '?',
  miss: '',
  blunder: '??',
};

/** Moves worth listing as key moments and marking on the graph. */
export const isNotable = (c: Classification) => SYMBOLS[c] !== '' || c === 'miss';

/**
 * Replays a game from its PGN without any engine work, so the board can show the moves
 * straight away while the analysis is still running.
 */
export function replayGame(pgn: string): { fens: string[]; moves: { san: string; uci: string }[] } {
  const parsed = new Chess();
  parsed.loadPgn(pgn);
  const board = new Chess(parsed.getHeaders().FEN);
  const fens = [board.fen()];
  const moves: { san: string; uci: string }[] = [];
  for (const move of parsed.history({ verbose: true })) {
    board.move(move.san);
    fens.push(board.fen());
    moves.push({ san: move.san, uci: `${move.from}${move.to}${move.promotion ?? ''}` });
  }
  return { fens, moves };
}
