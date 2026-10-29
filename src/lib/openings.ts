import openingsData from '../data/openings.json';

/**
 * ECO openings from lichess-org/chess-openings (CC0). Each entry is
 * [eco code, name, SAN moves without move numbers].
 */
type OpeningRow = [string, string, string];

export type Opening = { eco: string; name: string };

const normalize = (san: string) => san.replace(/[+#!?]/g, '');

const byMoves = new Map<string, Opening>();
for (const [eco, name, moves] of openingsData as OpeningRow[]) {
  byMoves.set(moves.split(' ').map(normalize).join(' '), { eco, name });
}

const MAX_PLIES = 40;

/**
 * Longest known opening that the first `ply` moves of the game match.
 * `sans` is the full SAN move list from the start of the game.
 */
export function openingAt(sans: string[], ply: number): Opening | null {
  const limit = Math.min(ply, MAX_PLIES, sans.length);
  for (let n = limit; n >= 1; n--) {
    const key = sans.slice(0, n).map(normalize).join(' ');
    const found = byMoves.get(key);
    if (found) return found;
  }
  return null;
}
