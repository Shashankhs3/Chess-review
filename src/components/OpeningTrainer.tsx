import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Chess, type Color, type Square } from 'chess.js';
import { Chessboard, type ChessboardOptions } from 'react-chessboard';
import { formatSanLine } from '../lib/coach';
import { hintStyles, legalTargets } from '../lib/dots';
import { OPENING_LINES } from '../lib/openingdb';
import { playSound, soundForSan } from '../lib/sound';
import { BOARD_COLORS } from '../lib/styles';
import { SICILIAN_REPERTOIRE } from '../data/sicilian_repertoire';

/**
 * Opening trainer. Drills a line move by move: the opponent's moves are played for you and
 * you must find your own. Spaced repetition (a Leitner box system, as in Chessdriller,
 * En Croissant and Listudy) schedules each line: a clean run moves it up a box and
 * makes it come back later, a slip moves it down so it comes back sooner. Progress is
 * kept on this device.
 */

const START_FEN = new Chess().fen();
const BOT_DELAY_MS = 450;
const PROGRESS_KEY = 'chess-review.trainer.v1';
const SAVED_KEY = 'chess-review.prep-lines.v1';
const DAY_MS = 24 * 60 * 60 * 1000;
/** Days until a line is due again, by box (0 = due straight away). */
const INTERVAL_DAYS = [0, 1, 3, 7, 14, 30];
const MAX_BOX = INTERVAL_DAYS.length - 1;

type Drill = { id: string; name: string; side: Color; moves: string[] };
type Progress = { box: number; due: number; runs: number; clean: number };
type SavedLine = { id: string; name: string; side: Color; path: string[] };

function loadProgress(): Record<string, Progress> {
  try {
    const raw = localStorage.getItem(PROGRESS_KEY);
    return raw ? (JSON.parse(raw) as Record<string, Progress>) : {};
  } catch {
    return {};
  }
}

function storeProgress(progress: Record<string, Progress>): void {
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress));
  } catch {
    // Storage blocked: progress lasts for this visit only.
  }
}

/** The lines saved from Opening prep, as SAN. */
function savedDrills(): Drill[] {
  try {
    const raw = localStorage.getItem(SAVED_KEY);
    const lines = raw ? (JSON.parse(raw) as SavedLine[]) : [];
    return lines.map((line) => {
      const board = new Chess();
      const moves: string[] = [];
      for (const uci of line.path) {
        try {
          moves.push(board.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }).san);
        } catch {
          break;
        }
      }
      return { id: `saved:${line.id}`, name: line.name, side: line.side, moves };
    });
  } catch {
    return [];
  }
}

/** A finished run: a clean one climbs a box, a run with slips drops one. */
function review(previous: Progress | undefined, clean: boolean): Progress {
  const box = clean ? Math.min(MAX_BOX, (previous?.box ?? 0) + 1) : Math.max(0, (previous?.box ?? 0) - 1);
  return {
    box,
    due: Date.now() + INTERVAL_DAYS[box] * DAY_MS,
    runs: (previous?.runs ?? 0) + 1,
    clean: (previous?.clean ?? 0) + (clean ? 1 : 0),
  };
}

function dueText(progress: Progress | undefined): string {
  if (!progress) return 'New';
  const left = progress.due - Date.now();
  if (left <= 0) return `Box ${progress.box}/${MAX_BOX} · due now`;
  return `Box ${progress.box}/${MAX_BOX} · due in ${Math.ceil(left / DAY_MS)}d`;
}

export function OpeningTrainer() {
  const [progress, setProgress] = useState<Record<string, Progress>>(() => loadProgress());
  const [drill, setDrill] = useState<Drill | null>(null);
  const [ply, setPly] = useState(0);
  /** Wrong tries on the current move, and over the whole line. */
  const [misses, setMisses] = useState(0);
  const [lineMisses, setLineMisses] = useState(0);
  const [message, setMessage] = useState('');
  const [result, setResult] = useState<string | null>(null);
  const [pick, setPick] = useState<{ fen: string; square: string } | null>(null);
  const [query, setQuery] = useState('');
  const [searchSide, setSearchSide] = useState<Color>('w');

  const drills = useMemo<Drill[]>(
    () => [
      ...SICILIAN_REPERTOIRE.map((line) => ({ id: `rep:${line.name}`, name: line.name, side: 'w' as Color, moves: line.moves })),
      ...savedDrills(),
    ],
    [],
  );

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return OPENING_LINES.filter((o) => o.name.toLowerCase().includes(q) || o.eco.toLowerCase() === q)
      .sort((a, b) => a.name.length - b.name.length)
      .slice(0, 6);
  }, [query]);

  // The position after the moves played so far.
  const game = useMemo(() => {
    const board = new Chess();
    if (drill) for (let i = 0; i < ply; i++) board.move(drill.moves[i]);
    return board;
  }, [drill, ply]);
  const fen = game.fen();
  const total = drill?.moves.length ?? 0;
  const userTurn = !!drill && ply < total && (ply % 2 === 0) === (drill.side === 'w');
  const expected = drill && ply < total ? drill.moves[ply] : null;

  // The opponent's moves are played for you.
  useEffect(() => {
    if (!drill || ply >= drill.moves.length || userTurn) return;
    const timer = setTimeout(() => {
      playSound(soundForSan(drill.moves[ply]));
      setPly((p) => p + 1);
      setMisses(0);
    }, BOT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [drill, ply, userTurn]);

  // Record the run once the whole line has been played.
  useEffect(() => {
    if (!drill || ply < drill.moves.length || result !== null) return;
    const clean = lineMisses === 0;
    setProgress((previous) => {
      const next = { ...previous, [drill.id]: review(previous[drill.id], clean) };
      storeProgress(next);
      return next;
    });
    setResult(
      clean
        ? 'Perfect run. This line moves up a box and comes back later.'
        : `Finished with ${lineMisses} slip${lineMisses === 1 ? '' : 's'}. This line moves down a box and comes back sooner.`,
    );
  }, [drill, ply, lineMisses, result]);

  function start(next: Drill) {
    setDrill(next);
    setPly(0);
    setMisses(0);
    setLineMisses(0);
    setMessage('');
    setResult(null);
    setPick(null);
  }

  /** The line that has waited longest: new lines first, then the earliest due. */
  function trainNext() {
    const now = Date.now();
    const due = drills
      .filter((d) => d.moves.length > 0 && (progress[d.id]?.due ?? 0) <= now)
      .sort((a, b) => (progress[a.id]?.due ?? 0) - (progress[b.id]?.due ?? 0));
    if (due[0]) start(due[0]);
    else setMessage('Nothing is due right now. Pick any line to practise it anyway.');
  }

  function tryMove(from: string, to: string): boolean {
    if (!drill || !userTurn || expected === null) return false;
    const probe = new Chess(fen);
    const piece = probe.get(from as Square);
    const promotion = piece?.type === 'p' && (to[1] === '8' || to[1] === '1') ? 'q' : undefined;
    let made;
    try {
      made = probe.move({ from, to, promotion });
    } catch {
      playSound('illegal');
      return false;
    }
    if (made.san === expected) {
      playSound(soundForSan(made.san));
      setPly((p) => p + 1);
      setMisses(0);
      setMessage('');
      return true;
    }
    playSound('illegal');
    setMisses((m) => m + 1);
    setLineMisses((m) => m + 1);
    setMessage(`${made.san} is not the book move here. Try again.`);
    return false;
  }

  function hint() {
    if (!userTurn) return;
    setMisses(2);
    setLineMisses((m) => m + 1);
  }

  const pickedSquare = pick && pick.fen === fen ? pick.square : null;

  const squareStyles = useMemo(() => {
    const styles: Record<string, CSSProperties> = {};
    if (pickedSquare) styles[pickedSquare] = { backgroundColor: 'rgba(120, 170, 255, 0.55)' };
    for (const [target, style] of Object.entries(hintStyles(fen, pickedSquare))) {
      styles[target] = { ...styles[target], ...style };
    }
    // After two wrong tries (or a hint) the book move is shown on the board.
    if (userTurn && expected && misses >= 2) {
      try {
        const answer = new Chess(fen).move(expected);
        styles[answer.from] = { ...styles[answer.from], backgroundColor: 'rgba(255, 226, 0, 0.55)' };
        styles[answer.to] = { ...styles[answer.to], backgroundColor: 'rgba(255, 226, 0, 0.55)' };
      } catch {
        // The line has an illegal move; nothing to show.
      }
    }
    return styles;
  }, [fen, pickedSquare, userTurn, expected, misses]);

  const boardOptions: ChessboardOptions = {
    position: fen,
    boardOrientation: drill?.side === 'b' ? 'black' : 'white',
    allowDragging: userTurn,
    animationDurationInMs: 120,
    lightSquareStyle: { backgroundColor: BOARD_COLORS.light },
    darkSquareStyle: { backgroundColor: BOARD_COLORS.dark },
    squareStyles,
    onPieceDrop: ({ sourceSquare, targetSquare }) => (targetSquare ? tryMove(sourceSquare, targetSquare) : false),
    onSquareClick: ({ square }) => {
      if (!userTurn) return;
      if (pickedSquare && legalTargets(fen, pickedSquare).some((t) => t.to === square)) {
        tryMove(pickedSquare, square);
        setPick(null);
        return;
      }
      const piece = game.get(square as Square);
      setPick(piece && piece.color === drill?.side && square !== pickedSquare ? { fen, square } : null);
    },
  };

  const dueCount = drills.filter((d) => (progress[d.id]?.due ?? 0) <= Date.now()).length;
  const played = drill ? formatSanLine(START_FEN, drill.moves.slice(0, ply)) : '';

  return (
    <div className="prep">
      <div className="prep-board">
        <div className="board-wrap">
          <Chessboard options={boardOptions} />
        </div>
      </div>

      <aside className="prep-panel">
        <section className="card">
          <h3>Opening trainer</h3>
          {!drill && (
            <p className="hint small">
              Pick a line to drill. The opponent&apos;s moves are played for you, and you find yours. Lines you get right
              come back later; lines you miss come back sooner.
            </p>
          )}
          {drill && (
            <>
              <p className="small">
                <b>{drill.name}</b> · you play {drill.side === 'w' ? 'White' : 'Black'}
              </p>
              <p className="status">
                {result !== null ? 'Line complete.' : userTurn ? 'Your move.' : 'Opponent moves…'} · move{' '}
                {Math.min(Math.ceil((ply + 1) / 2), Math.ceil(total / 2))} of {Math.ceil(total / 2)}
              </p>
              {message && <p className="feedback">{message}</p>}
              {userTurn && expected && misses >= 2 && (
                <p className="feedback">
                  The book move is <b>{expected}</b>.
                </p>
              )}
              {result && <p className="feedback">{result}</p>}
              <p className="small notation-line">{played || 'No moves yet.'}</p>
              <div className="prep-row">
                <button onClick={hint} disabled={!userTurn}>
                  Hint
                </button>
                <button onClick={() => start(drill)}>Restart line</button>
                <button className="primary" onClick={trainNext}>
                  Next due line
                </button>
              </div>
            </>
          )}
          {!drill && (
            <div className="prep-row">
              <button className="primary" onClick={trainNext}>
                Train next due line
              </button>
            </div>
          )}
          {!drill && message && <p className="feedback">{message}</p>}
          <p className="hint small">
            {dueCount} of {drills.length} lines due. Progress is kept on this device.
          </p>
        </section>

        <section className="card">
          <h3>Your lines</h3>
          <p className="hint small">The Sicilian repertoire for White, and the lines you saved in Opening prep.</p>
          <div className="prep-list">
            {drills.map((d) => (
              <button key={d.id} onClick={() => start(d)}>
                {d.name} <span className="hint">{dueText(progress[d.id])}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="card">
          <h3>Any opening</h3>
          <div className="prep-row">
            <button className={searchSide === 'w' ? 'active' : ''} onClick={() => setSearchSide('w')}>
              I play White
            </button>
            <button className={searchSide === 'b' ? 'active' : ''} onClick={() => setSearchSide('b')}>
              I play Black
            </button>
          </div>
          <input
            placeholder="Opening name or ECO, e.g. French or C00"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search openings to train"
          />
          <div className="prep-list">
            {matches.map((line, i) => (
              <button
                key={`${line.eco}-${line.name}-${i}`}
                onClick={() =>
                  start({ id: `eco:${line.eco}:${line.name}:${searchSide}`, name: `${line.name} (${line.eco})`, side: searchSide, moves: line.moves })
                }
              >
                <span className="hint">{line.eco}</span> {line.name}
              </button>
            ))}
          </div>
        </section>
      </aside>
    </div>
  );
}
