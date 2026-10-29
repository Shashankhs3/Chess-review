import { Chess } from 'chess.js';
import type { ChessComGame } from './chesscom';
import openingsData from '../data/openings.json';

/**
 * Opening database built from real games (chess.com archives of the players you choose).
 * For every position in the first plies, it records each move played there and how the game
 * ended. Stored in IndexedDB, so it's built once and reused on every visit.
 */

/** [total games, white wins, draws, black wins] for one move in one position. */
export type MoveStats = [number, number, number, number];

export type OpeningDb = {
  built: number;
  players: string[];
  games: number;
  /** position key (board + side to move) → move SAN → stats */
  positions: Record<string, Record<string, MoveStats>>;
};

export type MoveOption = { san: string; total: number; whiteWin: number; draw: number; blackWin: number };

/** How deep into each game the database goes. The opening is what matters for preparation. */
export const DB_PLIES = 30;

const DB_NAME = 'chess-review';
const STORE = 'openings';
const KEY = 'opening-db-v1';

/** Position key: board and side to move only, so transpositions share their statistics. */
export function positionKey(fen: string): string {
  return fen.split(' ').slice(0, 2).join(' ');
}

/** Builds the database from games. Result is taken from chess.com's per-side `result`. */
export function buildDb(games: ChessComGame[], players: string[]): OpeningDb {
  const positions: OpeningDb['positions'] = {};
  for (const game of games) {
    const whiteResult = game.white.result === 'win' ? 'w' : game.black.result === 'win' ? 'b' : 'd';
    const replay = new Chess();
    try {
      replay.loadPgn(game.pgn);
    } catch {
      continue;
    }
    const history = replay.history({ verbose: true });
    const board = new Chess(replay.getHeaders().FEN);
    for (let i = 0; i < Math.min(DB_PLIES, history.length); i++) {
      const key = positionKey(board.fen());
      const san = history[i].san;
      const slot = (positions[key] ??= {});
      const stats = (slot[san] ??= [0, 0, 0, 0]);
      stats[0] += 1;
      if (whiteResult === 'w') stats[1] += 1;
      else if (whiteResult === 'b') stats[3] += 1;
      else stats[2] += 1;
      board.move(san);
    }
  }
  return { built: Date.now(), players, games: games.length, positions };
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Loads the saved database, or null if none has been built yet. */
export async function loadDb(): Promise<OpeningDb | null> {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(KEY);
      request.onsuccess = () => resolve((request.result as OpeningDb | undefined) ?? null);
      request.onerror = () => reject(request.error);
    });
  } catch {
    return null;
  }
}

export async function saveDb(data: OpeningDb): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(data, KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function clearDb(): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Moves played in a position, most common first. */
export function movesIn(data: OpeningDb | null, fen: string): MoveOption[] {
  const slot = data?.positions[positionKey(fen)];
  if (!slot) return [];
  return Object.entries(slot)
    .map(([san, [total, whiteWin, draw, blackWin]]) => ({ san, total, whiteWin, draw, blackWin }))
    .sort((a, b) => b.total - a.total);
}

/** Score for `side` (0–1) from a move's results: a win is 1, a draw 0.5. */
export function scoreFor(move: MoveOption, side: 'w' | 'b'): number {
  const wins = side === 'w' ? move.whiteWin : move.blackWin;
  return (wins + move.draw * 0.5) / move.total;
}

export type OpeningLine = { eco: string; name: string; moves: string[] };

/** Every opening in the ECO table, with its SAN line. */
export const OPENING_LINES: OpeningLine[] = (openingsData as [string, string, string][]).map(([eco, name, moves]) => ({
  eco,
  name,
  moves: moves.split(' '),
}));
