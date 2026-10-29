import { Chess } from 'chess.js';
import type { Classification, Color, GameAnalysis } from './analysis';
import type { ChessComGame } from './chesscom';

/**
 * Local game history. Each analysed game is kept as a compact record (counts and
 * phase averages, not every engine line), so 50+ games fit comfortably in localStorage.
 */

export type Phase = 'opening' | 'middlegame' | 'endgame';
export const PHASES: Phase[] = ['opening', 'middlegame', 'endgame'];

export type SideRecord = {
  /** Our estimate for this side's accuracy. */
  accuracy: number | null;
  counts: Partial<Record<Classification, number>>;
  /** Sum and count of per-move accuracies per phase, so averages can be weighted by moves. */
  phaseAccuracySum: Record<Phase, number>;
  phaseMoves: Record<Phase, number>;
  /** Errors per phase (inaccuracy, mistake, miss, blunder). */
  phaseErrors: Record<Phase, number>;
};

export type SavedGame = {
  url: string;
  endTime: number;
  timeClass: string;
  timeControl: string;
  opening: string | null;
  depth: number;
  /** The player whose history this game belongs to (their chess.com username). */
  player: string;
  playerColor: Color;
  playerRating: number;
  opponent: string;
  outcome: 'win' | 'loss' | 'draw';
  /** chess.com's own accuracy for the player, when chess.com has reviewed the game. */
  chessComAccuracy: number | null;
  white: SideRecord;
  black: SideRecord;
};

const STORAGE_KEY = 'chess-review.games.v1';
const MAX_GAMES = 300;

const ERRORS: Classification[] = ['inaccuracy', 'mistake', 'miss', 'blunder'];

const DRAWN = ['draw', 'agreed', 'repetition', 'stalemate', 'insufficient', '50move', 'timevsinsufficient'];

/** Opening = first 20 plies; endgame = little material left besides kings and pawns. */
export function phaseOf(index: number, fen: string): Phase {
  if (index < 20) return 'opening';
  const board = new Chess(fen).board().flat();
  const value: Record<string, number> = { q: 9, r: 5, b: 3, n: 3 };
  const material = board.reduce((sum, cell) => (cell ? sum + (value[cell.type] ?? 0) : sum), 0);
  return material <= 26 ? 'endgame' : 'middlegame';
}

function emptyRecord(): SideRecord {
  return {
    accuracy: null,
    counts: {},
    phaseAccuracySum: { opening: 0, middlegame: 0, endgame: 0 },
    phaseMoves: { opening: 0, middlegame: 0, endgame: 0 },
    phaseErrors: { opening: 0, middlegame: 0, endgame: 0 },
  };
}

/**
 * The named player's result in a game, from chess.com's per-side `result` field
 * ("win" for the winner; losers get a reason such as "checkmated" or "resigned";
 * draws use "agreed", "stalemate", "repetition", and similar). Null if the player is not in the game.
 */
export function outcomeFor(game: ChessComGame, player: string): SavedGame['outcome'] | null {
  const user = player.toLowerCase();
  const me =
    game.white.username.toLowerCase() === user ? game.white : game.black.username.toLowerCase() === user ? game.black : null;
  if (!me) return null;
  if (me.result === 'win') return 'win';
  return DRAWN.includes(me.result) ? 'draw' : 'loss';
}

/** Builds the compact record for one analysed game, from the player's point of view. */
export function summarizeGame(
  game: ChessComGame,
  analysis: GameAnalysis,
  player: string,
  depth: number,
): SavedGame | null {
  const user = player.toLowerCase();
  const playerColor: Color | null =
    game.white.username.toLowerCase() === user ? 'w' : game.black.username.toLowerCase() === user ? 'b' : null;
  if (!playerColor) return null;

  const white = emptyRecord();
  const black = emptyRecord();
  const sideOf = (color: Color) => (color === 'w' ? white : black);

  analysis.moves.forEach((move, index) => {
    const side = sideOf(move.color);
    side.counts[move.classification] = (side.counts[move.classification] ?? 0) + 1;
    const phase = phaseOf(index, analysis.fens[index]);
    side.phaseAccuracySum[phase] += move.accuracy;
    side.phaseMoves[phase] += 1;
    if (ERRORS.includes(move.classification)) side.phaseErrors[phase] += 1;
  });
  white.accuracy = analysis.accuracy.w;
  black.accuracy = analysis.accuracy.b;

  const me = playerColor === 'w' ? game.white : game.black;
  const other = playerColor === 'w' ? game.black : game.white;
  const outcome: SavedGame['outcome'] = me.result === 'win' ? 'win' : DRAWN.includes(me.result) ? 'draw' : 'loss';

  return {
    url: game.url,
    endTime: game.endTime,
    timeClass: game.timeClass,
    timeControl: game.timeControl,
    opening: null,
    depth,
    player,
    playerColor,
    playerRating: me.rating,
    opponent: other.username,
    outcome,
    chessComAccuracy: game.accuracies ? (playerColor === 'w' ? game.accuracies.white : game.accuracies.black) : null,
    white,
    black,
  };
}

/** Reads all saved games. Returns an empty list if storage is missing or corrupt. */
export function loadGames(): SavedGame[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as SavedGame[]) : [];
  } catch {
    return [];
  }
}

/** Adds or replaces a game (matched by URL). Keeps the newest MAX_GAMES. */
export function saveGame(game: SavedGame): void {
  try {
    const others = loadGames().filter((g) => g.url !== game.url);
    const next = [game, ...others].sort((a, b) => b.endTime - a.endTime).slice(0, MAX_GAMES);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage full or blocked: the analysis is still shown, it just isn't kept.
  }
}

export function clearGames(player?: string): void {
  try {
    if (!player) {
      localStorage.removeItem(STORAGE_KEY);
      return;
    }
    const kept = loadGames().filter((g) => g.player.toLowerCase() !== player.toLowerCase());
    localStorage.setItem(STORAGE_KEY, JSON.stringify(kept));
  } catch {
    // ignore
  }
}

/** The player's most recent games, newest first, optionally filtered by time class. */
export function selectGames(all: SavedGame[], player: string, timeClass: string, limit: number): SavedGame[] {
  const user = player.toLowerCase();
  return all
    .filter((g) => g.player.toLowerCase() === user && (timeClass === 'all' || g.timeClass === timeClass))
    .sort((a, b) => b.endTime - a.endTime)
    .slice(0, limit);
}

export type Aggregate = {
  games: number;
  /** Average of our estimate, over all selected games. */
  accuracy: number | null;
  /** Average of chess.com's accuracy, over the games where chess.com reported one. */
  chessComAccuracy: number | null;
  chessComGames: number;
  perGame: Record<Classification, number>;
  phaseAccuracy: Record<Phase, number | null>;
  phaseErrorsPerGame: Record<Phase, number>;
  byTimeClass: Record<string, { games: number; accuracy: number | null }>;
  wins: number;
  losses: number;
  draws: number;
  /** Average rating the player had in these games. */
  averageRating: number | null;
};

const avg = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);

/** Aggregates the player's side across the given games. */
export function aggregate(games: SavedGame[]): Aggregate {
  const sides = games.map((g) => ({ game: g, side: g.playerColor === 'w' ? g.white : g.black }));
  const perGame = Object.fromEntries(
    ['brilliant', 'great', 'best', 'excellent', 'good', 'inaccuracy', 'mistake', 'miss', 'blunder'].map((c) => [c, 0]),
  ) as Record<Classification, number>;
  const n = games.length || 1;

  for (const { side } of sides) {
    for (const key of Object.keys(perGame) as Classification[]) perGame[key] += side.counts[key] ?? 0;
  }
  for (const key of Object.keys(perGame) as Classification[]) perGame[key] /= n;

  const phaseAccuracy = {} as Record<Phase, number | null>;
  const phaseErrorsPerGame = {} as Record<Phase, number>;
  for (const phase of PHASES) {
    const sum = sides.reduce((s, { side }) => s + side.phaseAccuracySum[phase], 0);
    const moves = sides.reduce((s, { side }) => s + side.phaseMoves[phase], 0);
    phaseAccuracy[phase] = moves ? sum / moves : null;
    phaseErrorsPerGame[phase] = sides.reduce((s, { side }) => s + side.phaseErrors[phase], 0) / n;
  }

  const byTimeClass: Aggregate['byTimeClass'] = {};
  for (const { game } of sides) {
    const bucket = (byTimeClass[game.timeClass] ??= { games: 0, accuracy: null });
    bucket.games += 1;
  }
  for (const timeClass of Object.keys(byTimeClass)) {
    const values = sides
      .filter(({ game }) => game.timeClass === timeClass)
      .map(({ side }) => side.accuracy)
      .filter((v): v is number => v !== null);
    byTimeClass[timeClass].accuracy = avg(values);
  }

  const ccValues = games.map((g) => g.chessComAccuracy).filter((v): v is number => v !== null);
  return {
    games: games.length,
    accuracy: avg(sides.map(({ side }) => side.accuracy).filter((v): v is number => v !== null)),
    chessComAccuracy: avg(ccValues),
    chessComGames: ccValues.length,
    perGame,
    phaseAccuracy,
    phaseErrorsPerGame,
    byTimeClass,
    averageRating: avg(games.map((g) => g.playerRating)),
    wins: games.filter((g) => g.outcome === 'win').length,
    losses: games.filter((g) => g.outcome === 'loss').length,
    draws: games.filter((g) => g.outcome === 'draw').length,
  };
}

/**
 * Rough playing-strength estimate from average accuracy. Anchored to two unofficial
 * community figures: about 65% accuracy for a 1000-rated player, and about 80% for 1600
 * (from a chess.com blog's rule of thumb). Linear between and beyond them, clamped to
 * 400–2600. Accuracy depends on position difficulty and review settings, so treat
 * the result as a rough guide, roughly ±300 Elo, not a measurement.
 */
export const RATING_ESTIMATE_UNCERTAINTY = 300;
export function estimateRating(accuracy: number): number {
  const rating = 1000 + (accuracy - 65) * 40;
  return Math.round(Math.min(2600, Math.max(400, rating)) / 10) * 10;
}

/**
 * Rating guess from one set of accuracy and error counts: the average of an accuracy
 * estimate and an error-based estimate. The error weights are heuristics. Used both for a
 * whole sample of games (per-game averages) and for a single game.
 */
export function strengthFrom(accuracy: number | null, counts: Partial<Record<Classification, number>>): number | null {
  if (accuracy === null) return null;
  const penalty =
    (counts.blunder ?? 0) * 250 +
    (counts.miss ?? 0) * 120 +
    (counts.mistake ?? 0) * 60 +
    (counts.inaccuracy ?? 0) * 25;
  const fromErrors = Math.min(2600, Math.max(400, 1800 - penalty));
  return Math.round(((estimateRating(accuracy) + fromErrors) / 2) / 10) * 10;
}

/** Rating guess for one saved game, from the player's side only. */
export function gameStrength(game: SavedGame): number | null {
  const side = game.playerColor === 'w' ? game.white : game.black;
  return strengthFrom(side.accuracy, side.counts);
}

export type StrengthEstimate = {
  /** Final rough rating, rounded to 10 Elo. Null when there are too few games. */
  rating: number | null;
  /** Estimate from accuracy alone (anchored as above). */
  fromAccuracy: number | null;
  /** Estimate from the error rates per game, weighted by how costly each error is. */
  fromErrors: number | null;
  reasons: string[];
};

/**
 * Rating guess from a full-game breakdown, not from accuracy alone: the accuracy estimate is
 * averaged with an estimate from errors per game. Stockfish finds many more misses and
 * inaccuracies than a human notices, so the error estimate uses weights that
 * are heuristics, not calibrated against rated games.
 */
export function estimateStrength(agg: Aggregate): StrengthEstimate {
  if (agg.games < 10) {
    return {
      rating: null,
      fromAccuracy: null,
      fromErrors: null,
      reasons: [`Need at least 10 analysed games for a rating guess. You have ${agg.games}.`],
    };
  }

  const reasons: string[] = [];
  const fromAccuracy = agg.accuracy !== null ? estimateRating(agg.accuracy) : null;
  if (fromAccuracy !== null) {
    reasons.push(`Average accuracy ${agg.accuracy?.toFixed(1)}% gives about ${fromAccuracy}.`);
  }

  const { blunder, miss, mistake, inaccuracy } = agg.perGame;
  const penalty = blunder * 250 + miss * 120 + mistake * 60 + inaccuracy * 25;
  const fromErrors = Math.round(Math.min(2600, Math.max(400, 1800 - penalty)) / 10) * 10;
  reasons.push(
    `Per game: ${blunder.toFixed(2)} blunders, ${miss.toFixed(2)} misses, ${mistake.toFixed(2)} mistakes, ${inaccuracy.toFixed(2)} inaccuracies. Error-based estimate: about ${fromErrors}.`,
  );

  const rating = fromAccuracy === null ? fromErrors : strengthFrom(agg.accuracy, agg.perGame);
  if (fromAccuracy !== null && Math.abs(fromAccuracy - fromErrors) >= 200) {
    reasons.push('The two estimates disagree a lot, so the real strength is uncertain. Look at the errors list before trusting this.');
  }
  return { rating, fromAccuracy, fromErrors, reasons };
}

export type Suggestion = { area: string; severity: number; advice: string };

/**
 * Rule-based advice from the aggregate. Each rule only fires when the numbers cross
 * a threshold, and the advice quotes the player's own numbers.
 */
export function suggestions(agg: Aggregate): Suggestion[] {
  if (agg.games < 5) {
    return [
      {
        area: 'Not enough games yet',
        severity: 0,
        advice: `Analyse at least 5 games to see patterns. You have ${agg.games}.`,
      },
    ];
  }

  const out: Suggestion[] = [];
  const misses = agg.perGame.miss;
  if (misses >= 0.5) {
    out.push({
      area: 'Tactics',
      severity: misses * 2,
      advice: `You leave winning tactics on the board: ${misses.toFixed(1)} misses per game. Solve tactics puzzles daily, and before each move check checks, captures and mate threats.`,
    });
  }

  const blunders = agg.perGame.blunder;
  if (blunders >= 0.3) {
    out.push({
      area: 'Blunders',
      severity: blunders * 3,
      advice: `You blunder ${blunders.toFixed(2)} times per game. Before every move, ask what your move leaves undefended and what the opponent's checks and captures do.`,
    });
  }

  const mistakes = agg.perGame.mistake + agg.perGame.inaccuracy;
  if (mistakes >= 1.5) {
    out.push({
      area: 'Calculation',
      severity: mistakes * 0.5,
      advice: `You make ${mistakes.toFixed(1)} mistakes or inaccuracies per game. Slow down on critical moments and calculate the forcing moves first.`,
    });
  }

  const { opening, middlegame, endgame } = agg.phaseAccuracy;
  if (endgame !== null && middlegame !== null && endgame < middlegame - 4) {
    out.push({
      area: 'Endgames',
      severity: (middlegame - endgame) * 0.4,
      advice: `Your accuracy drops to ${endgame.toFixed(1)}% in endgames, against ${middlegame.toFixed(1)}% in the middlegame. Study king-and-pawn endings and basic rook endgames.`,
    });
  }
  if (opening !== null && middlegame !== null && opening < middlegame - 4) {
    out.push({
      area: 'Openings',
      severity: (middlegame - opening) * 0.4,
      advice: `Your first 20 plies average ${opening.toFixed(1)}%, against ${middlegame.toFixed(1)}% later. Review your repertoire's main lines and why they work.`,
    });
  }

  const classes = Object.entries(agg.byTimeClass).filter(([, v]) => v.games >= 5 && v.accuracy !== null);
  if (classes.length >= 2) {
    const sorted = [...classes].sort((a, b) => (b[1].accuracy ?? 0) - (a[1].accuracy ?? 0));
    const [bestName, best] = sorted[0];
    const [worstName, worst] = sorted[sorted.length - 1];
    if ((best.accuracy ?? 0) - (worst.accuracy ?? 0) >= 5) {
      out.push({
        area: `Time control: ${worstName}`,
        severity: ((best.accuracy ?? 0) - (worst.accuracy ?? 0)) * 0.3,
        advice: `You play ${worstName} at ${worst.accuracy?.toFixed(1)}%, against ${best.accuracy?.toFixed(1)}% in ${bestName}. Slow down when the clock is short, or play fewer ${worstName} games.`,
      });
    }
  }

  out.sort((a, b) => b.severity - a.severity);
  return out.length
    ? out.slice(0, 3)
    : [{ area: 'No clear weakness', severity: 0, advice: 'No pattern crosses the warning thresholds in these games. Keep reviewing to catch new habits.' }];
}
