import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Chess, type Color, type Square } from 'chess.js';
import { Chessboard, type ChessboardOptions } from 'react-chessboard';
import { uciToSan } from '../lib/analysis';
import { OPENING_LINES, type OpeningLine } from '../lib/openingdb';
import { SICILIAN_REPERTOIRE } from '../data/sicilian_repertoire';
import type { LiveLine } from '../lib/engine';
import {
  libraryMoves,
  libraryScore,
  trapsToSet,
  loadLibrary,
  openingNameFor,
  type Library,
  type LibraryMove,
} from '../lib/openinglibrary';
import { hintStyles, legalTargets } from '../lib/dots';
import { BOARD_COLORS } from '../lib/styles';
import { playSound, soundForSan } from '../lib/sound';
import { EngineArrows, type OverlayArrow } from './EngineArrows';
import { Icon } from './Icon';
import { LivePanel } from './LivePanel';

/**
 * Opening preparation. Choose a side and an opening; the opponent follows the prepared line
 * and then the most common move in the statistics. Each of your moves is checked against
 * the statistics: book, playable, rare, or a mistake, with its score for you.
 *
 * Every position is kept in a timeline, so you can step back and forward (Start, Back, Next,
 * End) or click any move in the notation. Playing a different move from an earlier position
 * starts a new continuation. Lines can be saved and loaded on this device.
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
const SAVED_KEY = 'chess-review.prep-lines.v1';

const pct = (value: number) => `${Math.round(value * 100)}%`;

/** One position on the timeline, and the move that led to it. */
type Entry = {
  fen: string;
  /** UCI moves from the start to this position. */
  path: string[];
  /** SAN of the move that led here (null for the start position). */
  san: string | null;
  /** What we said about the move that led here. */
  note: string | null;
  /** A trap warning raised by the opponent's reply that led here. */
  trap: string | null;
  /** Set when the statistics have run out: you then play both sides yourself. */
  open?: boolean;
};

/** A line you prepared, kept on this device. */
type SavedLine = { id: string; name: string; side: Color; path: string[] };

const startEntry = (): Entry => ({ fen: START_FEN, path: [], san: null, note: null, trap: null });

function loadSaved(): SavedLine[] {
  try {
    const raw = localStorage.getItem(SAVED_KEY);
    return raw ? (JSON.parse(raw) as SavedLine[]) : [];
  } catch {
    return [];
  }
}

function storeSaved(lines: SavedLine[]): void {
  try {
    localStorage.setItem(SAVED_KEY, JSON.stringify(lines));
  } catch {
    // Storage blocked: lines last for this visit only.
  }
}

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

function isLegal(fen: string, uci: string): boolean {
  try {
    new Chess(fen).move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    return true;
  } catch {
    return false;
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

/** The Sicilian repertoire lines as UCI, which the opponent follows when you play White. */
const REPERTOIRE_UCI = SICILIAN_REPERTOIRE.map((o) => toUciLine(o.moves));

export function OpeningPrep() {
  const [library, setLibrary] = useState<Library | null>(null);
  const [libraryState, setLibraryState] = useState<'loading' | 'ready' | 'missing'>('loading');
  const [side, setSide] = useState<Color>('w');
  const [query, setQuery] = useState('');
  const [opening, setOpening] = useState<OpeningLine | null>(null);
  const [prepared, setPrepared] = useState<string[]>([]);
  const [started, setStarted] = useState(false);
  const [timeline, setTimeline] = useState<Entry[]>([startEntry()]);
  const [at, setAt] = useState(0);
  const [saved, setSaved] = useState<SavedLine[]>(() => loadSaved());
  const [showTraps, setShowTraps] = useState(false);
  const [live, setLive] = useState<{ fen: string; lines: LiveLine[] }>({ fen: '', lines: [] });
  // The piece picked up by a click, tagged with its position so it clears when the board changes.
  const [pick, setPick] = useState<{ fen: string; square: string } | null>(null);
  const botTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The position on the board, and the moves that led to it.
  const current = timeline[at] ?? timeline[0];
  const fen = current.fen;
  const path = current.path;

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

  const handleLive = useCallback((lines: LiveLine[], forFen: string) => setLive({ fen: forFen, lines }), []);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    // Names that start with the search come first, then names that contain it, then shorter names.
    const find = (pool: OpeningLine[], limit: number) =>
      pool
        .filter((o) => o.name.toLowerCase().includes(q) || o.eco.toLowerCase() === q)
        .sort((a, b) => {
          const startA = a.name.toLowerCase().startsWith(q) ? 0 : 1;
          const startB = b.name.toLowerCase().startsWith(q) ? 0 : 1;
          return startA - startB || a.name.length - b.name.length;
        })
        .slice(0, limit);
    // The Sicilian repertoire is for White, so it is offered only when you play White, ahead of the ECO names.
    return side === 'w' ? [...find(SICILIAN_REPERTOIRE, 8), ...find(OPENING_LINES, 4)] : find(OPENING_LINES, 8);
  }, [query, side]);

  const candidates = useMemo(() => libraryMoves(library, path), [library, path]);
  const currentName = useMemo(() => openingNameFor(library, path), [library, path]);

  const board = new Chess(fen);
  const yourTurn = started && board.turn() === side && !board.isGameOver();
  const onPreparedLine = path.every((uci, i) => prepared[i] === uci);
  const expectedUci = prepared[path.length];

  // You can move a piece of the side to move, and both sides once the statistics have run out.
  const movableFrom = (square: string): boolean => {
    const piece = board.get(square as Square);
    if (!started || board.isGameOver() || !piece || piece.color !== board.turn()) return false;
    return board.turn() === side || current.open === true;
  };
  const pickedSquare = pick && pick.fen === fen ? pick.square : null;

  // Click-to-move dots: the picked piece is highlighted, and each square it can reach is marked.
  const moveStyles = useMemo(() => {
    const styles: Record<string, CSSProperties> = {};
    if (pickedSquare) styles[pickedSquare] = { backgroundColor: 'rgba(120, 170, 255, 0.55)' };
    for (const [target, hint] of Object.entries(hintStyles(fen, pickedSquare))) {
      styles[target] = { ...styles[target], ...hint };
    }
    return styles;
  }, [fen, pickedSquare]);

  // The engine's lines only count for the position on the board; older lines are ignored.
  const liveLines = useMemo(() => (live.fen === fen ? live.lines : []), [live, fen]);

  // Traps you can set from here, scored as likelihood × potency (method from davidADSP/chess-trap-scorer, MIT).
  const traps = useMemo(
    () => (yourTurn ? trapsToSet(library, path, side).slice(0, 3) : []),
    [library, path, side, yourTurn],
  );

  // Arrows on your turn: gold for the most played move in the statistics, blue for the engine's
  // second-best, green for the engine's best. Drawn in that order, so green sits on top.
  const arrows: OverlayArrow[] = useMemo(() => {
    const list: OverlayArrow[] = [];
    // Trap moves first, underneath everything else, when the trap button is on.
    if (showTraps && yourTurn) {
      for (const t of traps) {
        if (isLegal(fen, t.move)) {
          list.push({ startSquare: t.move.slice(0, 2), endSquare: t.move.slice(2, 4), color: 'rgba(255, 226, 0, 0.95)', width: 0.22 });
        }
      }
    }
    const mostPlayed = yourTurn ? candidates[0]?.uci : undefined;
    const second = liveLines[1]?.pv[0];
    const top = liveLines[0]?.pv[0];
    if (mostPlayed && isLegal(fen, mostPlayed)) {
      // Wider than the engine arrows, so it still shows as a gold edge when the engine plays the same move.
      list.push({
        startSquare: mostPlayed.slice(0, 2),
        endSquare: mostPlayed.slice(2, 4),
        color: 'rgba(245, 190, 60, 0.95)',
        width: 0.3,
      });
    }
    if (second && isLegal(fen, second)) {
      list.push({ startSquare: second.slice(0, 2), endSquare: second.slice(2, 4), color: 'rgba(92, 139, 176, 0.85)' });
    }
    if (top && isLegal(fen, top)) {
      list.push({ startSquare: top.slice(0, 2), endSquare: top.slice(2, 4), color: 'rgba(129, 182, 76, 0.9)' });
    }
    return list;
  }, [candidates, fen, liveLines, showTraps, traps, yourTurn]);

  // ----- The opponent -----

  /**
   * The opponent's reply, added after `base` (the timeline up to the position they answer).
   * The prepared line comes first, then the most common move in the statistics.
   */
  function scheduleBot(base: Entry[], line: string[], mySide: Color) {
    if (botTimer.current) clearTimeout(botTimer.current);
    botTimer.current = setTimeout(() => {
      const last = base[base.length - 1];
      const position = new Chess(last.fen);
      const opponent: Color = mySide === 'w' ? 'b' : 'w';
      if (position.turn() !== opponent || position.isGameOver()) return;

      let uci: string | null = null;
      let san: string | null = null;
      let source = '';
      let trapText: string | null = null;

      // The main line first, then any saved variation for this side that runs through this position.
      const variations = [
        line,
        ...saved.filter((s) => s.side === mySide).map((s) => s.path),
        ...(mySide === 'w' ? REPERTOIRE_UCI : []),
      ];
      for (const variation of variations) {
        const depth = last.path.length;
        const sharesPath = variation.slice(0, depth).every((m, i) => m === last.path[i]);
        const next = variation[depth];
        if (!sharesPath || !next) continue;
        san = playUci(position, next);
        if (san) {
          uci = next;
          source = variation === line ? 'prepared line' : 'saved variation';
          break;
        }
      }

      if (!san) {
        const common = libraryMoves(library, last.path)[0];
        if (common) {
          san = playUci(position, common.uci);
          if (san) {
            uci = common.uci;
            source = 'most common in the statistics';
            const forYou = 1 - libraryScore(common, opponent);
            if (common.games >= TRAP_MIN_GAMES && forYou >= TRAP_SCORE) {
              trapText = `Trap ahead: ${san} is common here (${common.games} games) but scores ${pct(forYou)} for you.`;
            }
          }
        }
      }

      if (!san || !uci) {
        // The statistics have run out here, so the opponent cannot reply. Let you play both sides.
        setTimeline([
          ...base.slice(0, -1),
          {
            ...last,
            open: true,
            note: 'Beyond the statistics: the opponent cannot reply automatically. Play their moves yourself to continue.',
          },
        ]);
        return;
      }
      playSound(soundForSan(san));
      const entry: Entry = {
        fen: position.fen(),
        path: [...last.path, uci],
        san,
        note: `Opponent played ${san} (${source}).`,
        trap: trapText,
      };
      setTimeline([...base, entry]);
      setAt(base.length);
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
    if (!started) return false;
    const position = new Chess(fen);
    const mover = position.turn();
    // You move your own side, or both sides once the statistics have run out.
    if (mover !== side && !current.open) return false;
    let made;
    try {
      made = position.move({ from, to, promotion: promotionFor(position, from, to) });
    } catch {
      return false;
    }
    if (botTimer.current) clearTimeout(botTimer.current);
    const uci = `${made.from}${made.to}${made.promotion ?? ''}`;
    const entry: Entry = {
      fen: position.fen(),
      path: [...path, uci],
      san: made.san,
      note:
        mover === side
          ? judge(fen, path, uci, made.san, side)
          : `${made.san} is the opponent's move, played by you.`,
      trap: null,
      open: current.open,
    };
    // Playing from an earlier position replaces the continuation that followed it.
    const base = [...timeline.slice(0, at + 1), entry];
    setTimeline(base);
    setAt(base.length - 1);
    playSound(soundForSan(made.san));
    if (!position.isGameOver()) scheduleBot(base, prepared, side);
    return true;
  }

  // ----- Moving through the timeline -----

  function stopBot() {
    if (botTimer.current) clearTimeout(botTimer.current);
  }

  const goStart = () => {
    stopBot();
    setAt(0);
  };
  const goBack = () => {
    stopBot();
    setAt((i) => Math.max(0, i - 1));
  };
  const goNext = () => {
    stopBot();
    setAt((i) => Math.min(timeline.length - 1, i + 1));
  };
  const goEnd = () => {
    stopBot();
    setAt(timeline.length - 1);
  };
  const jumpTo = (index: number) => {
    stopBot();
    setAt(index);
  };

  function startPreparation(line: OpeningLine, chosen: Color) {
    stopBot();
    const uciLine = toUciLine(line.moves);
    const initial = [startEntry()];
    setOpening(line);
    setSide(chosen);
    setPrepared(uciLine);
    setTimeline(initial);
    setAt(0);
    setStarted(true);
    // White moves first, so if you play Black the opponent opens.
    if (chosen === 'b') scheduleBot(initial, uciLine, chosen);
  }

  function restartLine() {
    if (!opening) return;
    startPreparation(opening, side);
  }

  // ----- Saved lines -----

  function saveCurrentLine() {
    if (path.length === 0) return;
    const name = currentName ? currentName.name : 'Prepared line';
    const entry: SavedLine = { id: `${Date.now()}`, name: `${name} · ${path.length} plies`, side, path };
    const next = [entry, ...saved];
    setSaved(next);
    storeSaved(next);
    setTimeline((t) => t.map((e, i) => (i === at ? { ...e, note: `Saved "${entry.name}".` } : e)));
  }

  function deleteSaved(id: string) {
    const next = saved.filter((entry) => entry.id !== id);
    setSaved(next);
    storeSaved(next);
  }

  /** Loads a saved line onto the timeline and continues from its last move. */
  function loadSavedLine(entry: SavedLine) {
    stopBot();
    const position = new Chess(START_FEN);
    const entries: Entry[] = [startEntry()];
    for (const uci of entry.path) {
      const san = playUci(position, uci);
      if (!san) break;
      entries.push({ fen: position.fen(), path: [...entries[entries.length - 1].path, uci], san, note: null, trap: null });
    }
    entries[entries.length - 1] = { ...entries[entries.length - 1], note: `Loaded "${entry.name}".` };
    setStarted(true);
    setOpening(null);
    setSide(entry.side);
    setPrepared([]);
    setTimeline(entries);
    setAt(entries.length - 1);
    if (position.turn() !== entry.side && !position.isGameOver()) {
      scheduleBot(entries, [], entry.side);
    }
  }

  const boardOptions: ChessboardOptions = {
    position: fen,
    boardOrientation: side === 'b' ? 'black' : 'white',
    allowDragging: started,
    animationDurationInMs: 120,
    lightSquareStyle: { backgroundColor: BOARD_COLORS.light },
    darkSquareStyle: { backgroundColor: BOARD_COLORS.dark },
    squareStyles: moveStyles,
    onPieceDrop: ({ sourceSquare, targetSquare }) => (targetSquare ? playerMove(sourceSquare, targetSquare) : false),
    onSquareClick: ({ square }) => {
      // Click a dot to play the picked piece there; otherwise click a piece to pick it up.
      if (pickedSquare && legalTargets(fen, pickedSquare).some((t) => t.to === square)) {
        playerMove(pickedSquare, square);
        setPick(null);
        return;
      }
      setPick(movableFrom(square) && square !== pickedSquare ? { fen, square } : null);
    },
  };

  /** Move notation: "1. e4 e5 2. Nf3 …", each move clickable. */
  const notation = timeline.slice(1).map((entry, i) => ({ index: i + 1, san: entry.san ?? '' }));

  return (
    <div className="prep">
      <div className="prep-board">
        <div className="board-wrap">
          <Chessboard options={boardOptions} />
          <EngineArrows arrows={arrows} flipped={side === 'b'} />
        </div>
        <div className="board-nav" role="group" aria-label="Move navigation">
          <button onClick={goStart} disabled={at === 0} aria-label="Start">
            <Icon name="first" />
          </button>
          <button onClick={goBack} disabled={at === 0} aria-label="Back">
            <Icon name="prev" />
            <span>Back</span>
          </button>
          <span className="hint small">
            move {Math.ceil(at / 2)} of {Math.ceil((timeline.length - 1) / 2)}
          </span>
          <button onClick={goNext} disabled={at >= timeline.length - 1} aria-label="Next">
            <span>Next</span>
            <Icon name="next" />
          </button>
          <button onClick={goEnd} disabled={at >= timeline.length - 1} aria-label="End">
            <Icon name="last" />
          </button>
        </div>
      </div>

      <aside className="prep-panel">
        <section className="card sec-play">
          <h3>Play</h3>
          {!started && <p className="hint small">Pick an opening below to begin, or load a saved line.</p>}
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
              {yourTurn && (
                <p className="arrow-key small">
                  Arrows: <span className="key-dot" style={{ background: 'rgb(245, 190, 60)' }} /> most played in the
                  statistics · <span className="key-dot" style={{ background: 'rgb(92, 139, 176)' }} /> engine
                  second-best · <span className="key-dot" style={{ background: 'rgb(129, 182, 76)' }} /> engine best
                </p>
              )}
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
              {current.note && <p className="feedback">{current.note}</p>}
              {current.trap && <p className="trap">{current.trap}</p>}

              <div className="notation" aria-label="Moves">
                {notation.length === 0 && <span className="hint small">No moves yet.</span>}
                {notation.map(({ index, san }) => (
                  <button
                    key={index}
                    className={`move-btn ${index === at ? 'active' : ''}`}
                    onClick={() => jumpTo(index)}
                  >
                    {index % 2 === 1 && <span className="move-num">{Math.ceil(index / 2)}.</span>}
                    {san}
                  </button>
                ))}
              </div>

              <div className="prep-row">
                <button onClick={() => setShowTraps((v) => !v)} disabled={!yourTurn}>
                  {showTraps ? 'Hide traps' : 'Show traps'}
                </button>
                <button onClick={saveCurrentLine} disabled={path.length === 0}>
                  Save this line
                </button>
                <button onClick={restartLine} disabled={!opening}>
                  Restart line
                </button>
              </div>
            </>
          )}
        </section>

        {/* Shown from the start, so the engine is ready before you pick an opening. */}
        <div className="sec-engine">
          <LivePanel fen={fen} onLines={handleLive} />
        </div>

        <section className="card sec-open">
          <h3>Your side and opening</h3>
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

        <section className="card sec-variations">
          <h3>Prepared variations</h3>
          {saved.length === 0 && <p className="hint small">Lines you save appear here, kept on this device.</p>}
          {saved.map((entry) => (
            <div key={entry.id} className="saved-line">
              <span className="small">
                {entry.name} · {entry.side === 'w' ? 'White' : 'Black'}
              </span>
              <span className="prep-row">
                <button onClick={() => loadSavedLine(entry)}>Load</button>
                <button className="link" onClick={() => deleteSaved(entry.id)}>
                  Delete
                </button>
              </span>
            </div>
          ))}
        </section>

        <section className="card sec-stats">
          <h3>Statistics</h3>
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
      </aside>
    </div>
  );
}
