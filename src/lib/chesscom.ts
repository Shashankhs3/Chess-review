/** Reads public game archives from the chess.com Published-Data API. */

export type ChessComGame = {
  url: string;
  pgn: string;
  /** "bullet" | "blitz" | "rapid" | "daily" */
  timeClass: string;
  /** Base time and increment, e.g. "180+2" or "1/86400". */
  timeControl: string;
  endTime: number;
  /** chess.com's own accuracy for this game, present only when it has been reviewed there. */
  accuracies: { white: number; black: number } | null;
  white: { username: string; rating: number; result: string };
  black: { username: string; rating: number; result: string };
};

type RawGame = {
  url: string;
  pgn?: string;
  time_class: string;
  time_control: string;
  end_time: number;
  rules: string;
  accuracies?: { white: number; black: number };
  white: { username: string; rating: number; result: string };
  black: { username: string; rating: number; result: string };
};

/**
 * Fetches the most recent `months` monthly archives for a player and returns
 * standard-chess games with a PGN, newest first.
 */
export async function fetchRecentGames(username: string, months: number): Promise<ChessComGame[]> {
  const user = username.trim().toLowerCase();
  if (!user) throw new Error('Enter a chess.com username.');

  const archivesRes = await fetch(
    `https://api.chess.com/pub/player/${encodeURIComponent(user)}/games/archives`,
  );
  if (archivesRes.status === 404) throw new Error(`No chess.com player named "${user}".`);
  if (!archivesRes.ok) throw new Error(`chess.com returned HTTP ${archivesRes.status}.`);

  const { archives } = (await archivesRes.json()) as { archives: string[] };
  const recent = archives.slice(-months);

  const pages = await Promise.all(
    recent.map(async (url) => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Failed to load games from ${url} (HTTP ${res.status}).`);
      return (await res.json()) as { games: RawGame[] };
    }),
  );

  return pages
    .flatMap((page) => page.games ?? [])
    .filter((game) => game.rules === 'chess' && Boolean(game.pgn))
    .map((game) => ({
      url: game.url,
      pgn: game.pgn as string,
      timeClass: game.time_class,
      timeControl: game.time_control,
      endTime: game.end_time,
      accuracies: game.accuracies ?? null,
      white: game.white,
      black: game.black,
    }))
    .sort((a, b) => b.endTime - a.endTime);
}

/**
 * Returns the most recent `count` games across archives, fetching as many months as needed.
 * Used for batch analysis so the user can ask for 20 or 50 games rather than whole months.
 */
export async function fetchLastGames(username: string, count: number): Promise<ChessComGame[]> {
  const user = username.trim().toLowerCase();
  if (!user) throw new Error('Enter a chess.com username.');

  const archivesRes = await fetch(
    `https://api.chess.com/pub/player/${encodeURIComponent(user)}/games/archives`,
  );
  if (archivesRes.status === 404) throw new Error(`No chess.com player named "${user}".`);
  if (!archivesRes.ok) throw new Error(`chess.com returned HTTP ${archivesRes.status}.`);

  const { archives } = (await archivesRes.json()) as { archives: string[] };
  const collected: ChessComGame[] = [];
  // Walk back month by month, newest first, until we have enough games.
  for (let i = archives.length - 1; i >= 0 && collected.length < count; i--) {
    const res = await fetch(archives[i]);
    if (!res.ok) continue;
    const page = (await res.json()) as { games: RawGame[] };
    const games = (page.games ?? [])
      .filter((game) => game.rules === 'chess' && Boolean(game.pgn))
      .map((game) => ({
        url: game.url,
        pgn: game.pgn as string,
        timeClass: game.time_class,
        timeControl: game.time_control,
        endTime: game.end_time,
        accuracies: game.accuracies ?? null,
        white: game.white,
        black: game.black,
      }))
      .sort((a, b) => b.endTime - a.endTime);
    collected.push(...games);
  }
  return collected.sort((a, b) => b.endTime - a.endTime).slice(0, count);
}

/**
 * Readable time control from chess.com's string.
 * "300" → "5 min", "180+2" → "3 min + 2 s", "1/86400" → "1 day per move".
 */
export function formatTimeControl(timeControl: string): string {
  if (timeControl.includes('/')) {
    const seconds = Number(timeControl.split('/')[1]);
    return seconds >= 86400 ? `${Math.round(seconds / 86400)} day per move` : `${Math.round(seconds / 3600)} h per move`;
  }
  const [base, increment] = timeControl.split('+');
  const minutes = Number(base) / 60;
  const label = Number.isInteger(minutes) ? `${minutes} min` : `${Math.round(Number(base))} s`;
  return increment ? `${label} + ${increment} s` : label;
}
