/**
 * Opening statistics from the Chess Multiverse Opening Intelligence Database (20M Lichess subset,
 * 2024). Each record is a 10-ply line with game counts, win rates and an average rating.
 *
 * Source:  https://github.com/sciencewithsaucee-sudo/chessmultiverse-opening-analytics-2024
 * DOI:     https://doi.org/10.5281/zenodo.19307100
 * Licence: CC BY-SA 4.0. The data file is in public/data/ with ATTRIBUTION.txt.
 *
 * Every record is a full 10-ply line, so grouping records by their first k moves gives the
 * statistics of the next move after any prefix of up to 9 plies.
 */

type Raw = {
  eco: string;
  opening: string;
  moves: string;
  games: number;
  white_win_rate: number;
  black_win_rate: number;
  draw_rate: number;
  avg_rating: number;
};

type Accumulator = { games: number; white: number; black: number; draw: number; rating: number };

export type LibraryMove = {
  /** The next move, in UCI, e.g. "e2e4". */
  uci: string;
  games: number;
  whiteWin: number;
  blackWin: number;
  draw: number;
  avgRating: number;
};

export type Library = {
  /** key: the moves so far, space-separated UCI (empty string for the start position) */
  next: Map<string, Map<string, Accumulator>>;
  /** key: the full 10-ply line, space-separated UCI → opening name */
  names: Map<string, { name: string; eco: string; games: number }>;
  records: number;
};

const PLIES = 10;
const DATA_URL = `${import.meta.env.BASE_URL}data/openings_2024_depth5.json`;

let cached: Promise<Library | null> | null = null;

/** Loads and indexes the dataset once. Resolves to null if the file cannot be loaded. */
export function loadLibrary(): Promise<Library | null> {
  if (!cached) {
    cached = fetch(DATA_URL)
      .then((res) => (res.ok ? (res.json() as Promise<Raw[]>) : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((records) => buildIndex(records))
      .catch(() => {
        cached = null;
        return null;
      });
  }
  return cached;
}

function buildIndex(records: Raw[]): Library {
  const next = new Map<string, Map<string, Accumulator>>();
  const names = new Map<string, { name: string; eco: string; games: number }>();

  for (const record of records) {
    const moves = record.moves.split(' ');
    if (moves.length !== PLIES) continue;

    const key = moves.join(' ');
    const known = names.get(key);
    if (!known || record.games > known.games) {
      names.set(key, { name: record.opening, eco: record.eco, games: record.games });
    }

    for (let k = 0; k < PLIES; k++) {
      const prefix = moves.slice(0, k).join(' ');
      const slot = next.get(prefix) ?? new Map<string, Accumulator>();
      const acc = slot.get(moves[k]) ?? { games: 0, white: 0, black: 0, draw: 0, rating: 0 };
      // Weight each record's rates by its game count, so sums can be divided back into rates.
      acc.games += record.games;
      acc.white += record.games * record.white_win_rate;
      acc.black += record.games * record.black_win_rate;
      acc.draw += record.games * record.draw_rate;
      acc.rating += record.games * record.avg_rating;
      slot.set(moves[k], acc);
      next.set(prefix, slot);
    }
  }
  return { next, names, records: records.length };
}

/** The moves played from a position reached by `path` (UCI moves from the start), most common first. */
export function libraryMoves(library: Library | null, path: string[]): LibraryMove[] {
  const slot = library?.next.get(path.join(' '));
  if (!slot) return [];
  return [...slot.entries()]
    .map(([uci, acc]) => ({
      uci,
      games: acc.games,
      whiteWin: acc.white / acc.games,
      blackWin: acc.black / acc.games,
      draw: acc.draw / acc.games,
      avgRating: Math.round(acc.rating / acc.games),
    }))
    .sort((a, b) => b.games - a.games);
}

/** Score (0–1) for `side` for one move: a win is 1, a draw is 0.5. */
export function libraryScore(move: LibraryMove, side: 'w' | 'b'): number {
  return (side === 'w' ? move.whiteWin : move.blackWin) + move.draw * 0.5;
}

/** The most common opening name for a line that begins with `path`, or null if there is none. */
export function openingNameFor(library: Library | null, path: string[]): { name: string; eco: string } | null {
  if (!library || path.length === 0) return null;
  const prefix = path.join(' ');
  let best: { name: string; eco: string; games: number } | null = null;
  for (const [key, value] of library.names) {
    if (key === prefix || key.startsWith(`${prefix} `)) {
      if (!best || value.games > best.games) best = value;
    }
  }
  return best ? { name: best.name, eco: best.eco } : null;
}
