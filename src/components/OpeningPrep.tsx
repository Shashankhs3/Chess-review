import { useEffect, useMemo, useRef, useState } from 'react';
import { Chess, type Color, type Square } from 'chess.js';
import { Chessboard, type ChessboardOptions } from 'react-chessboard';
import { uciToSan } from '../lib/analysis';
import { OPENING_LINES, type OpeningLine } from '../lib/openingdb';
import {
  libraryMoves,
  libraryScore,
  trapsToSet,
  loadLibrary,
  openingNameFor,
  type Library,
  type LibraryMove,
} from '../lib/openinglibrary';
import { BOARD_COLORS } from '../lib/styles';
import { playSound, soundForSan } from '../lib/sound';

/**
 * Opening preparation. Choose a side and an opening; the opponent follows the prepared line
 * and then the most common move in the statistics. Each of your moves is checked against
 * the statistics: book, playable, rare, or a mistake, with its score for you.
 *
 * Statistics: Chess Multiverse Opening Intelligence Database (20M Lichess games, 2024), CC BY-SA 4.0.
 */

const START_FEN = new Chess().fen();
const BOT_DELAY_MS = 550;
/** Moves seen fewer times than this are called rare. */
const MIN_GAMES = 20;
/** A trap is a common opponent move that scores at least this well for you. */
const TRAP_SCORE = 0.6;
const TRAP_MIN_GAMES = 50;
/** A move scoring below this for you is called a mistake. */
const MISTAKE_SCORE = 0.45;

const pct = (value: number) => `${Math.round(value * 100)}%`;

function promotionFor(board: Chess, from: string, to: string): 'q' | undefined {
  const piece = board.get(from as Square);
  return piece?.type === 'p' && (to[1] === '8' || to[1] === '1') ? 'q' : undefined;
}

/** Plays a UCI move on `board`, returning its SAN, or null if it is illegal there. */
function playUci(board: Chess, uci: string): string | null {
  try {
    return board.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }).san;
  } catch {
    return null;
  }
}

/** UCI moves of a SAN line, from the start position. */
function toUciLine(sans: string[]): string[] {
  const board = new Chess();
  const out: string[] = [];
  for (const san of sans) {
    try {
      const made = board.move(san);
      out.push(`${made.from}${made.to}${made.promotion ?? ''}`);
    } catch {
      break;
    }
  }
  return out;
}

export function OpeningPrep() {
  const [library, setLibrary] = useState<Library | null>(null);
  const [libraryState, setLibraryState] = useState<'loading' | 'ready' | 'missing'>('loading');
  const [side, setSide] = useState<Color>('w');
  const [query, setQuery] = useState('');
  const [opening, setOpening] = useState<OpeningLine | null>(null);
  const [prepared, setPrepared] = useState<string[]>([]);
  const [fen, setFen] = useState(START_FEN);
  const [path, setPath] = useState<string[]>([]);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [trap, setTrap] = useState<string | null>(null);
  const [started, setStarted] = useState(false);
  const botTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let alive = true;
    void loadLibrary().then((lib) => {
      if (!alive) return;
      setLibrary(lib);
      setLibraryState(lib ? 'ready' : 'missing');
    });
    return () => {
      alive = false;
      if (botTimer.current) clearTimeout(botTimer.current);
    };
  }, []);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    // Names that start with the search come first, then names that contain it, then shorter names.
    return OPENING_LINES.filter((o) => o.name.toLowerCase().includes(q) || o.eco.toLowerCase() === q)
      .sort((a, b) => {
        const startA = a.name.toLowerCase().startsWith(q) ? 0 : 1;
        const startB = b.name.toLowerCase().startsWith(q) ? 0 : 1;
        return startA - startB || a.name.length - b.name.length;
      })
      .slice(0, 8);
  }, [query]);

  const candidates = useMemo(() => libraryMoves(library, path), [library, path]);
  const currentName = useMemo(() => openingNameFor(library, path), [library, path]);

  const board = new Chess(fen);
  const yourTurn = started && board.turn() === side && !board.isGameOver();
  const onPreparedLine = path.every((uci, i) => prepared[i] === uci);
  const expectedUci = prepared[path.length];

  // Traps you can set from here, scored as likelihood × potency (method from davidADSP/chess-trap-scorer, MIT).
  const traps = useMemo(
    () => (yourTurn ? trapsToSet(library, path, side).slice(0, 3) : []),
    [library, path, side, yourTurn],
  );

  // ----- The opponent -----

  /** The opponent's reply: the prepared line first, then the most common move in the statistics. */
  function scheduleBot(currentFen: string, playedPath: string[], line: string[], mySide: Color) {
    if (botTimer.current) clearTimeout(botTimer.current);
    botTimer.current = setTimeout(() => {
      const position = new Chess(currentFen);
      const opponent: Color = mySide === 'w' ? 'b' : 'w';
      if (position.turn() !== opponent || position.isGameOver()) return;

      let uci: string | null = null;
      let san: string | null = null;
      let source = '';

      const preparedNext = line[playedPath.length];
      if (preparedNext) {
        san = playUci(position, preparedNext);
        if (san) {
          uci = preparedNext;
          source = 'prepared line';
        }
      }

      if (!san) {
        const common = libraryMoves(library, playedPath)[0];
        if (common) {
          san = playUci(position, common.uci);
          if (san) {
            uci = common.uci;
            source = 'most common in the statistics';
            const forYou = 1 - libraryScore(common, opponent);
            if (common.games >= TRAP_MIN_GAMES && forYou >= TRAP_SCORE) {
              setTrap(`Trap ahead: ${san} is common here (${common.games} games) but scores ${pct(forYou)} for you.`);
            }
          }
        }
      }

      if (!san || !uci) {
        setFeedback('No statistics for this position. Play on by your own understanding.');
        return;
      }
      playSound(soundForSan(san));
      setFen(position.fen());
      setPath([...playedPath, uci]);
      setFeedback(`Opponent played ${san} (${source}).`);
    }, BOT_DELAY_MS);
  }

  // ----- Your moves -----

  function judge(beforeFen: string, beforePath: string[], uci: string, san: string, mySide: Color): string {
    if (!library) return 'The statistics are still loading.';
    const options: LibraryMove[] = libraryMoves(library, beforePath);
    const found = options.find((m) => m.uci === uci);
    const best = options[0];
    const expected = prepared[beforePath.length];
    const offLine = expected && expected !== uci ? ` Your prepared move is ${uciToSan(beforeFen, expected)}.` : '';

    if (!found || found.games < MIN_GAMES) {
      return `${san} is rare: ${found?.games ?? 0} games in the statistics.${offLine}`;
    }
    const score = libraryScore(found, mySide);
    const bestText =
      best && best.uci !== uci
        ? ` Most played: ${uciToSan(beforeFen, best.uci)} (${pct(libraryScore(best, mySide))} for you).`
        : '';
    if (score < MISTAKE_SCORE) {
      return `Mistake: ${san} scores only ${pct(score)} for you in ${found.games} games.${bestText}${offLine}`;
    }
    if (best && best.uci === uci) {
      return `Book move: ${san} is the most played here, scoring ${pct(score)} for you over ${found.games} games.`;
    }
    return `Playable: ${san} scores ${pct(score)} for you over ${found.games} games.${bestText}`;
  }

  function playerMove(from: string, to: string): boolean {
    if (!started || !opening) return false;
    const position = new Chess(fen);
    if (position.turn() !== side) return false;
    let made;
    try {
      made = position.move({ from, to, promotion: promotionFor(position, from, to) });
    } catch {
      return false;
    }
    if (botTimer.current) clearTimeout(botTimer.current);
    const uci = `${made.from}${made.to}${made.promotion ?? ''}`;
    const beforeFen = fen;
    const beforePath = path;
    const nextPath = [...path, uci];
    playSound(soundForSan(made.san));
    setFen(position.fen());
    setPath(nextPath);
    setTrap(null);
    setFeedback(judge(beforeFen, beforePath, uci, made.san, side));
    if (!position.isGameOver()) scheduleBot(position.fen(), nextPath, prepared, side);
    return true;
  }

  function startPreparation(line: OpeningLine, chosen: Color) {
    if (botTimer.current) clearTimeout(botTimer.current);
    const uciLine = toUciLine(line.moves);
    setOpening(line);
    setSide(chosen);
    setPrepared(uciLine);
    setFen(START_FEN);
    setPath([]);
    setFeedback(null);
    setTrap(null);
    setStarted(true);
    // White moves first, so if you play Black the opponent opens.
    if (chosen === 'b') scheduleBot(START_FEN, [], uciLine, chosen);
  }

  function restartLine() {
    if (!opening) return;
    startPreparation(opening, side);
  }

  const boardOptions: ChessboardOptions = {
    position: fen,
    boardOrientation: side === 'b' ? 'black' : 'white',
    allowDragging: started,
    animationDurationInMs: 120,
    lightSquareStyle: { backgroundColor: BOARD_COLORS.light },
    darkSquareStyle: { backgroundColor: BOARD_COLORS.dark },
    onPieceDrop: ({ sourceSquare, targetSquare }) => (targetSquare ? playerMove(sourceSquare, targetSquare) : false),
  };

  return (
    <div className="prep">
      <div className="prep-board">
        <Chessboard options={boardOptions} />
      </div>

      <aside className="prep-panel">
        <section className="card">
          <h3>1. Statistics</h3>
          {libraryState === 'loading' && <p className="hint small">Loading the opening statistics…</p>}
          {libraryState === 'missing' && (
            <p className="error small">The opening statistics file could not be loaded.</p>
          )}
          {libraryState === 'ready' && library && (
            <p className="hint small">
              {library.records.toLocaleString()} opening lines from 20 million rated Lichess games (2024). Each move
              shows how many games reached it and how it scored.
            </p>
          )}
          <p className="hint small">
            Data: Chess Multiverse Opening Intelligence Database, CC BY-SA 4.0. Source on GitHub: chessmultiverse-opening-analytics-2024.
          </p>
        </section>

        <section className="card">
          <h3>2. Your side and opening</h3>
          <div className="prep-row">
            <button className={side === 'w' ? 'active' : ''} onClick={() => setSide('w')}>
              I play White
            </button>
            <button className={side === 'b' ? 'active' : ''} onClick={() => setSide('b')}>
              I play Black
            </button>
          </div>
          <input
            placeholder="Opening name or ECO, e.g. Sicilian or B20"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search openings"
          />
          <div className="prep-list">
            {matches.map((line) => (
              <button key={`${line.eco}-${line.name}`} onClick={() => startPreparation(line, side)}>
                <span className="hint">{line.eco}</span> {line.name}
              </button>
            ))}
          </div>
          {opening && (
            <p className="small">
              Preparing <b>{opening.name}</b> as {side === 'w' ? 'White' : 'Black'}.{' '}
              <button className="link" onClick={restartLine}>
                Restart
              </button>
            </p>
          )}
        </section>

        <section className="card">
          <h3>3. Play</h3>
          {!started && <p className="hint small">Pick an opening above to begin.</p>}
          {started && (
            <>
              <p className="status">
                {board.isCheckmate()
                  ? 'Checkmate.'
                  : board.isDraw()
                    ? 'Draw.'
                    : yourTurn
                      ? 'Your move.'
                      : 'Opponent is thinking…'}
              </p>
              <p className="small">
                {onPreparedLine ? (
                  <span className="book-tag">On the prepared line</span>
                ) : (
                  <span className="mistake-tag">Off the prepared line</span>
                )}
                {currentName && <> · {currentName.name} ({currentName.eco})</>}
              </p>
              {yourTurn && expectedUci && (
                <p className="small">
                  Prepared move: <b>{uciToSan(fen, expectedUci)}</b>
                </p>
              )}
              {yourTurn && candidates.length > 0 && (
                <div className="book-list">
                  <span className="hint small">Most played here:</span>
                  {candidates.slice(0, 3).map((m) => (
                    <span key={m.uci} className="small">
                      {uciToSan(fen, m.uci)} · {m.games} games · {pct(libraryScore(m, side))} for you
                    </span>
                  ))}
                </div>
              )}
              {yourTurn && traps.length > 0 && (
                <div className="book-list">
                  <span className="hint small">Traps to set here (likelihood × potency):</span>
                  {traps.map((t) => {
                    const afterMine = new Chess(fen);
                    playUci(afterMine, t.move);
                    return (
                      <span key={`${t.move}-${t.reply}`} className="small">
                        {uciToSan(fen, t.move)}, then if {uciToSan(afterMine.fen(), t.reply)} ({pct(t.likelihood)} of
                        their replies): they score {pct(1 - t.potency)} · trap score {pct(t.score)}
                      </span>
                    );
                  })}
                </div>
              )}
              {feedback && <p className="feedback">{feedback}</p>}
              {trap && <p className="trap">{trap}</p>}
              <div className="prep-row">
                <button onClick={restartLine}>Restart line</button>
              </div>
            </>
          )}
        </section>
      </aside>
    </div>
  );
}
