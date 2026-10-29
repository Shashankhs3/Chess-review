import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { Chess, type Square } from 'chess.js';
import { Chessboard, type Arrow, type ChessboardOptions } from 'react-chessboard';
import { EvalGraph } from './components/EvalGraph';
import { PracticeBoard } from './components/PracticeBoard';
import { EngineArrows } from './components/EngineArrows';
import { playSound, setSoundEnabled, soundEnabled, soundForSan } from './lib/sound';
import { LivePanel } from './components/LivePanel';
import {
  analyzeGame,
  replayGame,
  formatEval,
  isNotable,
  winPercent,
  SYMBOLS,
  type AnalyzedMove,
  type Classification,
  type Color,
  type GameAnalysis,
} from './lib/analysis';
import { uciMove } from './lib/board';
import { hintStyles } from './lib/dots';
import { coachMove, formatSanLine, type MoveCoaching } from './lib/coach';
import { fetchLastGames, fetchRecentGames, formatTimeControl, type ChessComGame } from './lib/chesscom';
import {
  aggregate,
  clearGames,
  estimateStrength,
  gameStrength,
  loadGames,
  outcomeFor,
  RATING_ESTIMATE_UNCERTAINTY,
  PHASES,
  saveGame,
  selectGames,
  suggestions,
  summarizeGame,
  type SavedGame,
} from './lib/stats';
import { StockfishEngine, type LiveLine } from './lib/engine';
import { openingAt } from './lib/openings';
import { BOARD_COLORS, COLORS, LABELS } from './lib/styles';
import './App.css';

const START_FEN = new Chess().fen();

const DEPTH_OPTIONS = [
  { value: 12, label: 'Fast (depth 12)' },
  { value: 16, label: 'Standard (depth 16)' },
  { value: 20, label: 'Deep (depth 20)' },
];

/** Number of Stockfish workers for batch work: one core is left for the page and live engine. */
const POOL_SIZE = Math.max(2, Math.min(4, (navigator.hardwareConcurrency || 4) - 1));

const CLASSIFICATIONS: Classification[] = [
  'brilliant',
  'great',
  'best',
  'excellent',
  'good',
  'inaccuracy',
  'mistake',
  'miss',
  'blunder',
];

/** How many key moments to show before the "Show all" toggle. */
const MOMENTS_PREVIEW = 8;

/** The game itself, or a variation the user created on the board. */
type Cursor = { line: string; ply: number };

type Move = { san: string; uci: string };

/** A variation branches off `from` and holds its own positions. fens[0] is the branch point. */
type Branch = { id: string; from: Cursor; fens: string[]; moves: Move[] };

type TabId = 'engine' | 'moves' | 'coach' | 'stats';

type BatchProgress = { done: number; total: number; label: string };

function messageOf(error: unknown): string {
  if (error instanceof TypeError) {
    return 'Could not reach chess.com from the browser. Check your connection and try again.';
  }
  return error instanceof Error ? error.message : 'Something went wrong.';
}

function moveNumberLabel(index: number, move: AnalyzedMove): string {
  const number = Math.floor(index / 2) + 1;
  return move.color === 'w' ? `${number}. ${move.san}` : `${number}... ${move.san}`;
}

const RECENT_USERS_KEY = 'chess-review.recent-users.v1';
const MAX_RECENT_USERS = 8;

/** Recently searched chess.com usernames, newest first. */
function loadRecentUsers(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_USERS_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

/** Moves `name` to the front of the recent list and returns the updated list. */
function rememberUser(name: string): string[] {
  const lower = name.toLowerCase();
  const next = [name, ...loadRecentUsers().filter((u) => u.toLowerCase() !== lower)].slice(0, MAX_RECENT_USERS);
  try {
    localStorage.setItem(RECENT_USERS_KEY, JSON.stringify(next));
  } catch {
    // Storage blocked: the chips still work for this session.
  }
  return next;
}

/** Whether a UCI move is legal in `fen`. */
function isLegalUci(fen: string, uci: string): boolean {
  try {
    new Chess(fen).move(uciMove(uci));
    return true;
  } catch {
    return false;
  }
}

/** UCI for a drag or click from `from` to `to`, auto-promoting to a queen. */
function toUci(fen: string, from: string, to: string): string {
  const piece = new Chess(fen).get(from as Square);
  const promotion = piece?.type === 'p' && (to[1] === '8' || to[1] === '1') ? 'q' : '';
  return `${from}${to}${promotion}`;
}

export default function App() {
  const [username, setUsername] = useState('');
  const [loadedUser, setLoadedUser] = useState('');
  const [months, setMonths] = useState(1);
  const [depth, setDepth] = useState(16);
  const [savedAll, setSavedAll] = useState<SavedGame[]>(() => loadGames());
  const [recentUsers, setRecentUsers] = useState<string[]>(() => loadRecentUsers());
  const autoLoadedRef = useRef(false);
  const [batch, setBatch] = useState<BatchProgress | null>(null);
  const [statsTimeClass, setStatsTimeClass] = useState('all');
  const [statsLimit, setStatsLimit] = useState(50);
  const [games, setGames] = useState<ChessComGame[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [listNote, setListNote] = useState<string | null>(null);
  const [loadingGames, setLoadingGames] = useState(false);

  const [selected, setSelected] = useState<ChessComGame | null>(null);
  const [analysis, setAnalysis] = useState<GameAnalysis | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const [cursor, setCursor] = useState<Cursor>({ line: 'main', ply: 0 });
  const [preview, setPreview] = useState<{ fens: string[]; moves: Move[] }>({ fens: [START_FEN], moves: [] });
  const [autoPlay, setAutoPlay] = useState(false);
  // Last ply whose analysis is complete in order; during analysis the board follows it.
  const [syncPly, setSyncPly] = useState(0);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [pickedSquare, setPickedSquare] = useState<string | null>(null);
  // Live engine lines, stored with the position they were searched from.
  const [live, setLive] = useState<{ fen: string; lines: LiveLine[] }>({ fen: '', lines: [] });

  const [coachIndex, setCoachIndex] = useState<number | null>(null);
  const [showAllMoments, setShowAllMoments] = useState(false);
  const [tab, setTab] = useState<TabId>('engine');

  const enginesRef = useRef<StockfishEngine[] | null>(null);
  const batchRunRef = useRef(0);
  const runRef = useRef(0);
  const boardRowRef = useRef<HTMLDivElement>(null);
  const [boardPx, setBoardPx] = useState(360);

  useEffect(() => {
    return () => enginesRef.current?.forEach((engine) => engine.dispose());
  }, []);

  // After a reload, bring back the most recently searched player's games straight away.
  useEffect(() => {
    if (autoLoadedRef.current || recentUsers.length === 0) return;
    autoLoadedRef.current = true;
    void loadUser(recentUsers[0]);
    // Runs once on startup; loadUser reads the state it needs when it is called.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the board square and as large as the centre column allows.
  useEffect(() => {
    const row = boardRowRef.current;
    if (!row) return;
    const EVAL_BAR_AND_GAP = 26;
    const fit = () => {
      const width = row.clientWidth - EVAL_BAR_AND_GAP;
      const height = row.clientHeight;
      // Phones stack the page, so the row's height depends on the board itself.
      const side = window.innerWidth <= 1000 ? Math.min(width, 560) : Math.min(width, height);
      setBoardPx(Math.max(200, Math.floor(side)));
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(row);
    return () => observer.disconnect();
  }, [selected]);

  // ----- Lines: the game's main line and any variations the user has made -----

  // The game's moves are known as soon as it is opened (replayed from the PGN), so the board
  // can move while the engine is still working.
  const mainMoves: Move[] = useMemo(
    () => (analysis ? analysis.moves.map((m) => ({ san: m.san, uci: m.uci })) : preview.moves),
    [analysis, preview],
  );

  const branchById = (id: string): Branch | null => branches.find((b) => b.id === id) ?? null;

  const linePositions = (line: string): string[] =>
    line === 'main' ? (analysis ? analysis.fens : preview.fens) : branchById(line)?.fens ?? [];

  const lineMoves = (line: string): Move[] => (line === 'main' ? mainMoves : branchById(line)?.moves ?? []);

  const onMain = cursor.line === 'main';
  const fen = linePositions(cursor.line)[cursor.ply] ?? START_FEN;
  // Only live lines searched from the position on screen are used; anything older is ignored.
  const liveLines = live.fen === fen ? live.lines : [];
  const lastMove = cursor.ply > 0 ? lineMoves(cursor.line)[cursor.ply - 1] : undefined;

  /** Plays a UCI move from the current position: steps along an existing line or branches. */
  function playUci(uci: string): boolean {
    const board = new Chess(fen);
    let move;
    try {
      move = board.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    } catch {
      return false;
    }

    const { line, ply } = cursor;
    const moves = lineMoves(line);
    if (ply < moves.length && moves[ply].uci === uci) {
      setCursor({ line, ply: ply + 1 });
      return true;
    }

    const entry: Move = { san: move.san, uci };
    const newFen = board.fen();
    if (line !== 'main' && ply === moves.length) {
      // Continuing the variation we are already in.
      setBranches((bs) =>
        bs.map((b) => (b.id === line ? { ...b, fens: [...b.fens, newFen], moves: [...b.moves, entry] } : b)),
      );
      setCursor({ line, ply: ply + 1 });
      return true;
    }

    // A different move from a line: start a new variation here.
    const id = `b${Date.now()}`;
    setBranches((bs) => [...bs, { id, from: { line, ply }, fens: [fen, newFen], moves: [entry] }]);
    setCursor({ line: id, ply: 1 });
    return true;
  }

  // A move sound plays whenever the board advances by one move: stepping, replaying, or playing a move.
  const previousCursor = useRef(cursor);
  useEffect(() => {
    const before = previousCursor.current;
    previousCursor.current = cursor;
    if (before.line !== cursor.line || cursor.ply !== before.ply + 1) return;
    const move = lineMoves(cursor.line)[cursor.ply - 1];
    if (move) playSound(soundForSan(move.san));
    // lineMoves reads the current lines, which this effect already depends on through cursor and branches.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursor]);

  // The coaching card describes one move, so it closes once the user moves elsewhere.
  // It stays open on the position just before that move and the one just after it.
  useEffect(() => {
    if (coachIndex === null) return;
    if (cursor.line !== 'main' || (cursor.ply !== coachIndex && cursor.ply !== coachIndex + 1)) {
      setCoachIndex(null);
    }
  }, [cursor, coachIndex]);

  // While the analysis runs, the board follows the last analysed position.
  useEffect(() => {
    if (!autoPlay || !progress) return;
    setCursor({ line: 'main', ply: syncPly });
  }, [syncPly, autoPlay, progress]);

  // Once the analysis is done, play on from where the board is, one move at a time.
  useEffect(() => {
    if (!autoPlay || progress) return;
    const length = analysis ? analysis.moves.length : preview.moves.length;
    if (!onMain || cursor.ply >= length) {
      setAutoPlay(false);
      return;
    }
    const timer = setTimeout(() => setCursor({ line: 'main', ply: cursor.ply + 1 }), 700);
    return () => clearTimeout(timer);
  }, [autoPlay, cursor, analysis, preview, onMain]);

  function step(delta: number) {
    setAutoPlay(false);
    const { line, ply } = cursor;
    if (delta < 0) {
      if (ply === 0) {
        const branch = branchById(line);
        if (branch) setCursor(branch.from);
        return;
      }
      setCursor({ line, ply: ply - 1 });
      return;
    }
    if (ply < lineMoves(line).length) setCursor({ line, ply: ply + 1 });
  }

  // Arrow keys and Home/End step through whichever line is on screen.
  useEffect(() => {
    if (!selected) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'ArrowLeft') step(-1);
      if (event.key === 'ArrowRight') step(1);
      if (event.key === 'Home') setCursor({ line: 'main', ply: 0 });
      if (event.key === 'End') setCursor({ line: 'main', ply: mainMoves.length });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // ----- Evaluation and board -----

  const userColor: Color | null = useMemo(() => {
    if (!selected) return null;
    const user = loadedUser.toLowerCase();
    if (selected.white.username.toLowerCase() === user) return 'w';
    if (selected.black.username.toLowerCase() === user) return 'b';
    return null;
  }, [selected, loadedUser]);

  // The engine's own eval for the game, otherwise the live engine's.
  const mainEval = analysis && onMain ? analysis.evals[cursor.ply] : undefined;
  const liveTop = liveLines[0];
  const displayCp = mainEval ?? liveTop?.cp ?? 0;
  const evalLabel = mainEval !== undefined || liveTop ? formatEval(displayCp) : '';
  const whitePct = winPercent(displayCp);

  const handleLiveLines = useCallback((lines: LiveLine[], forFen: string) => setLive({ fen: forFen, lines }), []);

  // Arrows only ever show a move that is legal in the position on screen, so a stale
  // engine line can never point at an empty square.
  const arrows: Arrow[] = useMemo(() => {
    const list: Arrow[] = [];
    const drawable = (uci: string | undefined) => (uci && isLegalUci(fen, uci) ? uci : undefined);
    const second = drawable(liveLines[1]?.pv[0]);
    const top = drawable(liveLines[0]?.pv[0]) ?? drawable(onMain ? analysis?.bestMoves[cursor.ply] : undefined);
    if (second) {
      list.push({ startSquare: second.slice(0, 2), endSquare: second.slice(2, 4), color: 'rgba(92, 139, 176, 0.85)' });
    }
    if (top) {
      list.push({ startSquare: top.slice(0, 2), endSquare: top.slice(2, 4), color: 'rgba(129, 182, 76, 0.9)' });
    }
    return list;
  }, [analysis, cursor.ply, fen, liveLines, onMain]);

  const squareStyles = useMemo<Record<string, CSSProperties>>(() => {
    const styles: Record<string, CSSProperties> = {};
    if (lastMove) {
      const highlight = { backgroundColor: 'rgba(255, 220, 80, 0.45)' };
      styles[lastMove.uci.slice(0, 2)] = highlight;
      styles[lastMove.uci.slice(2, 4)] = highlight;
    }
    if (pickedSquare) styles[pickedSquare] = { backgroundColor: 'rgba(120, 170, 255, 0.55)' };
    // Dots and rings on the squares the picked piece can move to.
    for (const [target, hint] of Object.entries(hintStyles(fen, pickedSquare))) {
      styles[target] = { ...styles[target], ...hint };
    }
    return styles;
  }, [fen, lastMove, pickedSquare]);

  const boardOptions: ChessboardOptions = {
    position: fen,
    boardOrientation: userColor === 'b' ? 'black' : 'white',
    squareStyles,
    allowDragging: true,
    // Hand-drawn arrows are cleared whenever the position changes, so they never linger.
    clearArrowsOnPositionChange: true,
    animationDurationInMs: 150,
    lightSquareStyle: { backgroundColor: BOARD_COLORS.light },
    darkSquareStyle: { backgroundColor: BOARD_COLORS.dark },
    onPieceDrop: ({ sourceSquare, targetSquare }) => {
      setPickedSquare(null);
      if (!targetSquare) return false;
      return playUci(toUci(fen, sourceSquare, targetSquare));
    },
    onSquareClick: ({ square }) => {
      if (pickedSquare === square) {
        setPickedSquare(null);
        return;
      }
      if (pickedSquare && playUci(toUci(fen, pickedSquare, square))) {
        setPickedSquare(null);
        return;
      }
      // Any piece can be picked up to see where it can go; the move itself is checked on play.
      const piece = new Chess(fen).get(square as Square);
      setPickedSquare(piece ? square : null);
    },
  };

  // ----- Analysis-derived data -----

  const sans = useMemo(() => analysis?.moves.map((m) => m.san) ?? [], [analysis]);

  const gameOpening = useMemo(() => (analysis ? openingAt(sans, sans.length) : null), [analysis, sans]);

  const notable = useMemo(() => {
    if (!analysis) return [];
    return analysis.moves
      .map((move, index) => ({ move, index }))
      .filter(({ move }) => isNotable(move.classification) || move.missedTactic);
  }, [analysis]);

  const userNotable = useMemo(
    () => (userColor ? notable.filter(({ move }) => move.color === userColor) : []),
    [notable, userColor],
  );

  const opponentNotable = useMemo(
    () => (userColor ? notable.filter(({ move }) => move.color !== userColor) : []),
    [notable, userColor],
  );

  const coachNotes = useMemo(() => {
    const notes = new Map<number, MoveCoaching>();
    if (!analysis) return notes;
    for (const { index } of notable) notes.set(index, coachMove(analysis, index, userColor));
    return notes;
  }, [analysis, notable, userColor]);

  const missedTraps = userNotable.filter(({ index }) => coachNotes.get(index)?.missedTrap);

  // Every key moment in the game, both sides, in order: the Next/Previous coaching buttons walk these.
  const keyIndexes = useMemo(() => notable.map(({ index }) => index), [notable]);
  const keyPosition = coachIndex === null ? -1 : keyIndexes.indexOf(coachIndex);

  function stepKeyMoment(delta: number) {
    if (keyIndexes.length === 0) return;
    let next: number;
    if (keyPosition === -1) {
      next = delta > 0 ? keyIndexes[0] : keyIndexes[keyIndexes.length - 1];
    } else {
      const target = Math.min(keyIndexes.length - 1, Math.max(0, keyPosition + delta));
      next = keyIndexes[target];
    }
    showCoaching(next);
  }

  // Per-side counts for each class, shown side by side like chess.com's review.
  const classCounts = useMemo(() => {
    const emptyCounts = () =>
      Object.fromEntries(CLASSIFICATIONS.map((c) => [c, 0])) as Record<Classification, number>;
    const counts: Record<Color, Record<Classification, number>> = { w: emptyCounts(), b: emptyCounts() };
    for (const move of analysis?.moves ?? []) counts[move.color][move.classification]++;
    return counts;
  }, [analysis]);

  const activeCoach = useMemo(() => {
    if (!analysis || coachIndex === null) return null;
    return coachNotes.get(coachIndex) ?? coachMove(analysis, coachIndex, userColor);
  }, [analysis, coachIndex, coachNotes, userColor]);

  const rows = useMemo(() => {
    if (!analysis) return [];
    const list: { number: number; indexes: number[] }[] = [];
    for (let i = 0; i < analysis.moves.length; i += 2) {
      list.push({ number: i / 2 + 1, indexes: [i, i + 1].filter((n) => n < analysis.moves.length) });
    }
    return list;
  }, [analysis]);

  // ----- Actions -----

  /** A pool of engines so positions are analysed in parallel. */
  function getEngines(): StockfishEngine[] {
    if (!enginesRef.current) {
      enginesRef.current = Array.from({ length: POOL_SIZE }, () => new StockfishEngine(2));
    }
    return enginesRef.current;
  }

  /** Records a finished analysis in local history, for the Stats tab. */
  function recordAnalysis(game: ChessComGame, result: GameAnalysis) {
    const record = summarizeGame(game, result, loadedUser, depth);
    if (!record) return;
    record.opening = openingAt(result.moves.map((m) => m.san), result.moves.length)?.name ?? null;
    saveGame(record);
    setSavedAll(loadGames());
  }

  /** Analyses the most recent games in turn, saving each one (skips games already saved). */
  async function runBatch(count: number) {
    if (!loadedUser) return;
    const runId = ++batchRunRef.current;
    const cancelled = () => batchRunRef.current !== runId;
    setBatch({ done: 0, total: 0, label: 'Fetching games…' });
    try {
      const recent = await fetchLastGames(loadedUser, count);
      const saved = new Set(loadGames().map((g) => g.url));
      const todo = recent.filter((g) => !saved.has(g.url));
      setBatch({ done: 0, total: todo.length, label: 'Analysing' });
      for (let i = 0; i < todo.length && !cancelled(); i++) {
        const result = await analyzeGame(todo[i].pgn, getEngines(), { depth, isCancelled: cancelled });
        if (result && !cancelled()) recordAnalysis(todo[i], result);
        setBatch((b) => (b ? { ...b, done: i + 1 } : b));
      }
    } catch (error) {
      setListError(messageOf(error));
    } finally {
      if (!cancelled()) setBatch(null);
    }
  }

  function cancelBatch() {
    batchRunRef.current++;
    setBatch(null);
  }

  async function loadUser(name: string) {
    const clean = name.trim();
    if (!clean) return;
    setUsername(clean);
    setLoadingGames(true);
    setListError(null);
    setListNote(null);
    try {
      let list = await fetchRecentGames(clean, months);
      if (list.length === 0) {
        // Nothing in the chosen period (common for less active accounts): fall back to the latest games.
        list = await fetchLastGames(clean, 20);
        if (list.length > 0) setListNote(`No games in the last ${months} month${months > 1 ? 's' : ''}. Showing the ${list.length} most recent.`);
      }
      if (list.length === 0) throw new Error(`No standard games found for "${clean}".`);
      setRecentUsers(rememberUser(clean));
      setGames(list);
      setLoadedUser(clean);
    } catch (error) {
      setGames(null);
      setListError(messageOf(error));
    } finally {
      setLoadingGames(false);
    }
  }

  function handleLoad(event: FormEvent) {
    event.preventDefault();
    void loadUser(username);
  }

  async function openGame(game: ChessComGame) {
    const runId = ++runRef.current;
    const isCurrent = () => runRef.current === runId;

    setSelected(game);
    setAnalysis(null);
    setAnalysisError(null);
    setCursor({ line: 'main', ply: 0 });
    setPreview(replayGame(game.pgn));
    setSyncPly(0);
    setAutoPlay(true); // the board follows the analysis while it runs
    setBranches([]);
    setPickedSquare(null);
    setCoachIndex(null);
    setShowAllMoments(false);
    setProgress({ done: 0, total: 1 });

    try {
      const result = await analyzeGame(game.pgn, getEngines(), {
        depth,
        onProgress: (done, total) => {
          if (isCurrent()) setProgress({ done, total });
        },
        // Positions 0..n-1 are analysed, so the board can show position n-1.
        onPrefix: (analysedInOrder) => {
          if (isCurrent()) setSyncPly(Math.max(0, analysedInOrder - 1));
        },
        isCancelled: () => !isCurrent(),
      });
      if (result && isCurrent()) {
        setAnalysis(result);
        // Analysis finished: put the board back on the starting position, ready to browse.
        setAutoPlay(false);
        setCursor({ line: 'main', ply: 0 });
        recordAnalysis(game, result);
      }
    } catch (error) {
      if (isCurrent()) setAnalysisError(messageOf(error));
    } finally {
      if (isCurrent()) setProgress(null);
    }
  }

  function showCoaching(index: number) {
    setCoachIndex(index);
    setCursor({ line: 'main', ply: index });
    setTab('coach');
  }

  function clearVariations() {
    setBranches([]);
    if (!onMain) setCursor({ line: 'main', ply: 0 });
  }

  // ----- Rendering helpers -----

  const renderMoments = (items: { move: AnalyzedMove; index: number }[], keyPrefix: string) =>
    items.length === 0 ? (
      <p className="hint">Nothing notable here.</p>
    ) : (
      <>
        {(showAllMoments ? items : items.slice(0, MOMENTS_PREVIEW)).map(({ move, index }) => (
          <button key={`${keyPrefix}-${index}`} className="moment" onClick={() => showCoaching(index)}>
            <span className="dot" style={{ background: COLORS[move.classification] }} />
            <span className="moment-text">
              <b>{moveNumberLabel(index, move)}</b> {SYMBOLS[move.classification]}{' '}
              <span className="hint">{LABELS[move.classification]}</span>
              {move.missedTactic && <span className="tag">missed tactic</span>}
              <br />
              <small>
                {formatEval(analysis!.evals[index])} → {formatEval(analysis!.evals[index + 1])}
              </small>
            </span>
          </button>
        ))}
        {items.length > MOMENTS_PREVIEW && (
          <button className="show-more" onClick={() => setShowAllMoments((v) => !v)}>
            {showAllMoments ? 'Show fewer' : `Show all ${items.length}`}
          </button>
        )}
      </>
    );

  /** Stats tab: aggregates over the player's saved games, plus rule-based advice. */
  function renderStats() {
    const player = loadedUser;
    if (!player) return <p className="hint">Load a username first. Stats are kept per player.</p>;

    const list = selectGames(savedAll, player, statsTimeClass, statsLimit);
    const agg = aggregate(list);
    const tips = suggestions(agg);
    const strength = estimateStrength(agg);
    const pct = (v: number | null) => (v === null ? '–' : `${v.toFixed(1)}%`);

    return (
      <>
        <div className="stats-filters">
          <select value={statsTimeClass} onChange={(e) => setStatsTimeClass(e.target.value)} aria-label="Time control">
            <option value="all">All time controls</option>
            <option value="bullet">Bullet</option>
            <option value="blitz">Blitz</option>
            <option value="rapid">Rapid</option>
            <option value="daily">Daily</option>
          </select>
          <select value={statsLimit} onChange={(e) => setStatsLimit(Number(e.target.value))} aria-label="Games to include">
            <option value={20}>Last 20 games</option>
            <option value={50}>Last 50 games</option>
            <option value={300}>All saved</option>
          </select>
        </div>

        {list.length === 0 ? (
          <p className="hint">No saved games for this filter yet. Use “Analyse last 20” on the left.</p>
        ) : (
          <>
            <h3>Results ({agg.games} games)</h3>
            <p className="hint">
              {agg.wins} wins · {agg.draws} draws · {agg.losses} losses
            </p>
            <div className="stat-grid">
              <div>
                <span className="hint">Accuracy (our estimate)</span>
                <b>{pct(agg.accuracy)}</b>
              </div>
              <div>
                <span className="hint">chess.com accuracy ({agg.chessComGames} games)</span>
                <b>{pct(agg.chessComAccuracy)}</b>
              </div>
            </div>

            <h3>Estimated playing strength</h3>
            <div className="strength">
              {strength.rating !== null ? (
                <p>
                  Likely playing strength: about <b>{strength.rating}</b>
                  {agg.averageRating !== null && (
                    <> (your rating in these games averages {Math.round(agg.averageRating)})</>
                  )}
                </p>
              ) : null}
              <ul>
                {strength.reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
              {agg.chessComAccuracy !== null && (
                <p className="hint small">
                  chess.com's own accuracy averages {agg.chessComAccuracy.toFixed(1)}% over {agg.chessComGames} games.
                </p>
              )}
              <p className="hint small">
                Rough guide only, about ±{RATING_ESTIMATE_UNCERTAINTY} Elo. Accuracy depends on how hard the positions
                were and on the review settings, so it cannot give an exact rating.
              </p>
            </div>

            <h3>Per game</h3>
            <div className="stat-grid">
              {(['blunder', 'miss', 'mistake', 'inaccuracy'] as Classification[]).map((c) => (
                <div key={c}>
                  <span className="dot" style={{ background: COLORS[c] }} />
                  {LABELS[c]} <b>{agg.perGame[c].toFixed(2)}</b>
                </div>
              ))}
            </div>

            <h3>By phase</h3>
            <table className="stat-table">
              <thead>
                <tr>
                  <th>Phase</th>
                  <th>Accuracy</th>
                  <th>Errors / game</th>
                </tr>
              </thead>
              <tbody>
                {PHASES.map((p) => (
                  <tr key={p}>
                    <td>{p}</td>
                    <td>{pct(agg.phaseAccuracy[p])}</td>
                    <td>{agg.phaseErrorsPerGame[p].toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <h3>By time control</h3>
            <table className="stat-table">
              <thead>
                <tr>
                  <th>Time control</th>
                  <th>Games</th>
                  <th>Accuracy</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(agg.byTimeClass).map(([name, v]) => (
                  <tr key={name}>
                    <td>{name}</td>
                    <td>{v.games}</td>
                    <td>{pct(v.accuracy)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <h3>Where to improve</h3>
            {tips.map((t) => (
              <div key={t.area} className="tip">
                <b>{t.area}</b>
                <p>{t.advice}</p>
              </div>
            ))}

            <h3>Saved games</h3>
            <div className="saved-list">
              {list.map((g) => {
                const mine = g.playerColor === 'w' ? g.white : g.black;
                return (
                  <div key={g.url} className="saved-row">
                    <span>
                      {new Date(g.endTime * 1000).toLocaleDateString()} · {g.timeClass} · vs {g.opponent} ·{' '}
                      {g.outcome}
                    </span>
                    <small className="hint">
                      played like ~{gameStrength(g) ?? '–'} (your rating {g.playerRating}) · ours {pct(mine.accuracy)}
                      {g.chessComAccuracy !== null && <> · chess.com {pct(g.chessComAccuracy)}</>}
                      {g.opening && <> · {g.opening}</>}
                    </small>
                  </div>
                );
              })}
            </div>
            <button className="show-more" onClick={() => { clearGames(player); setSavedAll(loadGames()); }}>
              Delete saved games for {player}
            </button>
            <p className="hint small">Stored only in this browser, on this device.</p>
          </>
        )}
      </>
    );
  }

  const [view, setView] = useState<'review' | 'practice'>('review');
  const [soundOn, setSoundOn] = useState(() => soundEnabled());

  function toggleSound() {
    setSoundOn((on) => {
      setSoundEnabled(!on);
      return !on;
    });
  }

  const currentLineLabel = onMain
    ? `Game · move ${cursor.ply} of ${mainMoves.length}`
    : `Variation (${lineMoves(cursor.line).length} move${lineMoves(cursor.line).length === 1 ? '' : 's'})`;

  if (view === 'practice') {
    return (
      <div className="app">
        <header className="topbar">
          <h1>Practice board</h1>
          <button onClick={() => setView('review')}>← Back to review</button>
        </header>
        <PracticeBoard />
      </div>
    );
  }

  return (
    <div className="app">
      <header className="topbar">
        <h1>Chess Review</h1>
        <button onClick={() => setView('practice')} title="Free moves, set up positions, then play with the rules">
          Practice board
        </button>
        <button onClick={toggleSound} aria-pressed={soundOn} aria-label={soundOn ? 'Mute move sounds' : 'Turn on move sounds'}>
          {soundOn ? '🔊 Sound on' : '🔇 Sound off'}
        </button>
        <form className="load-form" onSubmit={handleLoad}>
          <input
            placeholder="chess.com username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            aria-label="chess.com username"
          />
          <select value={months} onChange={(e) => setMonths(Number(e.target.value))} aria-label="Months to load">
            {[1, 2, 3, 6].map((m) => (
              <option key={m} value={m}>
                Last {m} month{m > 1 ? 's' : ''}
              </option>
            ))}
          </select>
          <select value={depth} onChange={(e) => setDepth(Number(e.target.value))} aria-label="Engine depth">
            {DEPTH_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <button type="submit" disabled={loadingGames || !username.trim()}>
            {loadingGames ? 'Loading…' : 'Load games'}
          </button>
        </form>
        {recentUsers.length > 0 && (
          <div className="recent" aria-label="Recent searches">
            <span className="hint">Recent:</span>
            {recentUsers.map((name) => (
              <button key={name} className="chip" onClick={() => void loadUser(name)} disabled={loadingGames}>
                {name}
              </button>
            ))}
          </div>
        )}
      </header>

      <div className="workspace">
        <aside className="card game-list">
          <div className="batch">
            <p className="hint small">Analyse your last games and keep them for the Stats tab (on this device).</p>
            <div className="batch-buttons">
              <button onClick={() => runBatch(20)} disabled={!loadedUser || batch !== null}>
                Analyse last 20
              </button>
              <button onClick={() => runBatch(50)} disabled={!loadedUser || batch !== null}>
                Analyse last 50
              </button>
            </div>
            {batch && (
              <div className="progress">
                <div className="progress-fill" style={{ width: `${batch.total ? (batch.done / batch.total) * 100 : 0}%` }} />
                <span>
                  {batch.label} {batch.total ? `${batch.done}/${batch.total}` : ''}
                </span>
                <button className="cancel" onClick={cancelBatch}>Cancel</button>
              </div>
            )}
          </div>
          {listNote && <p className="hint small">{listNote}</p>}
          {listError && <p className="error small">{listError}</p>}
          {!games && !listError && <p className="hint">Load a username to see games.</p>}
          {games?.map((game) => {
            const isSaved = savedAll.some((g) => g.url === game.url);
            return (
              <button
                key={game.url}
                className={`game-card ${selected?.url === game.url ? 'active' : ''}`}
                onClick={() => openGame(game)}
              >
                <span>
                  {game.white.username} ({game.white.rating}) vs {game.black.username} ({game.black.rating})
                </span>
                <small>
                  {(() => {
                    const result = outcomeFor(game, loadedUser);
                    if (!result) return null;
                    const label = result === 'win' ? 'Won' : result === 'loss' ? 'Lost' : 'Draw';
                    return <span className={`result ${result}`}>{label}</span>;
                  })()}{' '}
                  <span className="tc">{game.timeClass}</span> {formatTimeControl(game.timeControl)} ·{' '}
                  {new Date(game.endTime * 1000).toLocaleDateString()}
                  <br />
                  {(() => {
                    const mine = loadedUser.toLowerCase() === game.white.username.toLowerCase() ? 'white' : 'black';
                    const cc = game.accuracies ? game.accuracies[mine] : null;
                    const ours = savedAll.find((g) => g.url === game.url);
                    const oursValue = ours ? (ours.playerColor === 'w' ? ours.white : ours.black).accuracy : null;
                    return (
                      <>
                        {cc !== null ? `chess.com ${cc.toFixed(1)}%` : 'chess.com: not reviewed'}
                        {oursValue !== null && <> · ours {oursValue.toFixed(1)}%</>}
                        {isSaved ? ' · saved' : ''}
                      </>
                    );
                  })()}
                </small>
              </button>
            );
          })}
        </aside>

        <main className="center">
          {!selected ? (
            <p className="hint center-hint">{games && games.length > 0 ? 'Pick a game to analyse.' : ''}</p>
          ) : (
            <>
              <div className="board-row" ref={boardRowRef}>
                <div className="eval-bar" aria-hidden="true" style={{ height: boardPx }}>
                  <div className="eval-white" style={{ height: `${whitePct}%` }} />
                </div>
                <div className="board-square" style={{ width: boardPx, height: boardPx }}>
                  <Chessboard options={boardOptions} />
                  <EngineArrows arrows={arrows} flipped={userColor === 'b'} />
                </div>
              </div>

              <div className="controls">
                <button onClick={() => { setAutoPlay(false); setCursor({ line: 'main', ply: 0 }); }} aria-label="Start">⏮</button>
                <button onClick={() => step(-1)} aria-label="Previous move">◀</button>
                <span className="eval-text">
                  {evalLabel && <>Eval {evalLabel}</>}
                  <span className="line-label">{currentLineLabel}</span>
                </span>
                <button onClick={() => step(1)} aria-label="Next move">▶</button>
                <button onClick={() => { setAutoPlay(false); setCursor({ line: 'main', ply: mainMoves.length }); }} aria-label="End">⏭</button>
                <button
                  onClick={() => setAutoPlay((on) => !on)}
                  aria-label={autoPlay ? 'Pause replay' : 'Play game'}
                  disabled={!selected || mainMoves.length === 0}
                >
                  {autoPlay ? '⏸' : '▶︎'}
                </button>
              </div>
              {!onMain && (
                <div className="variation-bar">
                  <span className="hint">Exploring a variation. Moves you play here are saved as a branch.</span>
                  <button onClick={() => step(-1)}>Back to branch point</button>
                </div>
              )}

              {gameOpening && (
                <p className="opening">
                  Opening: <b>{gameOpening.name}</b> <span className="hint">({gameOpening.eco})</span>
                </p>
              )}

              {analysis && <EvalGraph analysis={analysis} ply={onMain ? cursor.ply : -1} onSelect={(p) => setCursor({ line: 'main', ply: p })} />}

              {progress && (
                <div className="progress">
                  <div className="progress-fill" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
                  <span>
                    Analysing position {progress.done}/{progress.total} at depth {depth}…
                  </span>
                </div>
              )}
              {analysisError && <p className="error">{analysisError}</p>}
            </>
          )}
        </main>

        <aside className="side">
          {selected && <LivePanel fen={fen} onLines={handleLiveLines} />}

          <div className="tabs" role="tablist">
            {(
              [
                ['engine', 'Engine'],
                ['moves', 'Moves'],
                ['coach', 'Coach'],
                ['stats', 'Stats'],
              ] as [TabId, string][]
            ).map(([id, label]) => (
              <button
                key={id}
                role="tab"
                aria-selected={tab === id}
                className={`tab ${tab === id ? 'active' : ''}`}
                onClick={() => setTab(id)}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="card tab-body" role="tabpanel">
            {tab === 'engine' && (
              <>
                {!analysis && <p className="hint">{selected ? 'Analysis appears here when it finishes.' : 'Pick a game to see its analysis.'}</p>}
                {analysis && (
                  <>
                    <aside className="warn" aria-label="How to read these numbers">
                      <b>Read these as estimates</b>
                      <ul>
                        <li>
                          Stockfish {analysis.depth} on this device, not chess.com's engine or settings.
                          {analysis.depth <= 14 && ' Depth 14 can miss deep tactics; pick Deep (18) for a final check.'}
                        </li>
                        <li>
                          Accuracy uses a Lichess-style formula. chess.com's accuracy is a different formula, so
                          expect a gap of several points for the same game.
                        </li>
                        <li>
                          Labels follow chess.com's published thresholds, approximated in win-% points.
                          Opening book moves are not marked, so Best and Excellent counts can differ.
                        </li>
                      </ul>
                    </aside>

                    <div className="accuracy">
                      <div>
                        <strong>
                          {selected!.white.username}
                          {userColor === 'w' && <span className="you">you</span>}
                        </strong>
                        <span>{analysis.accuracy.w?.toFixed(1) ?? '–'}%</span>
                      </div>
                      <div>
                        <strong>
                          {selected!.black.username}
                          {userColor === 'b' && <span className="you">you</span>}
                        </strong>
                        <span>{analysis.accuracy.b?.toFixed(1) ?? '–'}%</span>
                      </div>
                    </div>

                    <div className="counts-table">
                      <div className="counts-row counts-head">
                        <span>{selected!.white.username}</span>
                        <span />
                        <span>{selected!.black.username}</span>
                      </div>
                      {CLASSIFICATIONS.map((c) => (
                        <div key={c} className="counts-row">
                          <b style={{ color: COLORS[c] }}>{classCounts.w[c]}</b>
                          <span>
                            <span className="dot" style={{ background: COLORS[c] }} />
                            {LABELS[c]}
                            {SYMBOLS[c] && <span className="symbol"> {SYMBOLS[c]}</span>}
                          </span>
                          <b style={{ color: COLORS[c] }}>{classCounts.b[c]}</b>
                        </div>
                      ))}
                    </div>

                    <h3>{userColor ? 'Your key moments' : 'Key moments'}</h3>
                    {renderMoments(userColor ? userNotable : notable, 'you')}

                    {userColor && (
                      <>
                        <h3>Opponent's key moments</h3>
                        {renderMoments(opponentNotable, 'opp')}
                      </>
                    )}

                    {missedTraps.length > 0 && (
                      <>
                        <h3>Missed traps</h3>
                        {missedTraps.map(({ index }) => (
                          <button key={index} className="moment trap" onClick={() => showCoaching(index)}>
                            <span className="moment-text">
                              <small>{coachNotes.get(index)?.missedTrap}</small>
                            </span>
                          </button>
                        ))}
                      </>
                    )}
                  </>
                )}
              </>
            )}

            {tab === 'moves' && (
              <>
                <h3>Game</h3>
                {analysis ? (
                  <div className="move-list">
                    {rows.map((row) => (
                      <div key={row.number} className="move-row">
                        <span className="num">{row.number}.</span>
                        {row.indexes.map((index) => {
                          const move = analysis.moves[index];
                          const notableMove = isNotable(move.classification) || move.missedTactic;
                          const active = onMain && cursor.ply === index + 1;
                          return (
                            <button
                              key={index}
                              className={`move ${active ? 'active' : ''} ${notableMove ? 'notable' : ''}`}
                              onClick={() => setCursor({ line: 'main', ply: index + 1 })}
                              title={LABELS[move.classification]}
                            >
                              {notableMove && <span className="dot" style={{ background: COLORS[move.classification] }} />}
                              {move.san}
                              {SYMBOLS[move.classification] && <span className="symbol">{SYMBOLS[move.classification]}</span>}
                            </button>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="hint">Moves appear after analysis.</p>
                )}

                <h3>Variations</h3>
                {branches.length === 0 && <p className="hint">Play a different move on the board to start one.</p>}
                {branches.map((b) => {
                  const startFen = linePositions(b.from.line)[b.from.ply];
                  const fromLabel = b.from.line === 'main' ? 'game' : 'variation';
                  return (
                    <button
                      key={b.id}
                      className={`variation ${cursor.line === b.id ? 'active' : ''}`}
                      onClick={() => setCursor({ line: b.id, ply: b.moves.length })}
                    >
                      <small className="hint">
                        Branches from the {fromLabel} · {b.moves.length} move{b.moves.length === 1 ? '' : 's'}
                      </small>
                      <span className="pv">{formatSanLine(startFen, b.moves.map((m) => m.san))}</span>
                    </button>
                  );
                })}
                {branches.length > 0 && (
                  <button className="show-more" onClick={clearVariations}>
                    Clear variations
                  </button>
                )}
              </>
            )}

            {tab === 'coach' && (
              <>
                {analysis && keyIndexes.length > 0 && (
                  <div className="key-nav">
                    <button onClick={() => stepKeyMoment(-1)} disabled={keyPosition === 0}>
                      ◀ Previous key moment
                    </button>
                    <span className="hint">
                      {keyPosition >= 0 ? `${keyPosition + 1} of ${keyIndexes.length}` : `${keyIndexes.length} key moments`}
                    </span>
                    <button onClick={() => stepKeyMoment(1)} disabled={keyPosition === keyIndexes.length - 1}>
                      Next key moment ▶
                    </button>
                  </div>
                )}
                {!activeCoach && <p className="hint">Pick a key moment in the Engine tab, or a move in the list, to see coaching.</p>}
                {activeCoach && (
                  <section className="coach" style={{ borderLeftColor: COLORS[activeCoach.classification] }}>
                    <div className="coach-head">
                      <h3>
                        <span className="coach-tag" style={{ background: COLORS[activeCoach.classification] }}>
                          {LABELS[activeCoach.classification]}
                        </span>{' '}
                        {activeCoach.label}
                      </h3>
                      <button onClick={() => setCoachIndex(null)} aria-label="Close coaching notes">
                        ✕
                      </button>
                    </div>
                    <p className="hint">Eval {activeCoach.evalChange}</p>

                    {activeCoach.highlights.length > 0 && (
                      <ul className="highlights">
                        {activeCoach.highlights.map((line) => (
                          <li key={line}>{line}</li>
                        ))}
                      </ul>
                    )}

                    {activeCoach.whatWentWrong.length > 0 && (
                      <>
                        <h4>What went wrong</h4>
                        <ul>
                          {activeCoach.whatWentWrong.map((line) => (
                            <li key={line}>{line}</li>
                          ))}
                        </ul>
                      </>
                    )}

                    {activeCoach.missedTrap && (
                      <p className="trap">
                        <b>Missed trap:</b> {activeCoach.missedTrap}
                      </p>
                    )}

                    {activeCoach.better && (
                      <>
                        <h4>
                          Better: <span className="best">{activeCoach.better.san}</span>
                        </h4>
                        <ul>
                          {activeCoach.better.reasons.map((reason) => (
                            <li key={reason}>{reason}</li>
                          ))}
                        </ul>
                        {activeCoach.better.line.length > 0 && (
                          <p className="line">Engine line: {activeCoach.better.line.join(' ')}</p>
                        )}
                      </>
                    )}

                    <button onClick={() => setCursor({ line: 'main', ply: activeCoach.index })}>
                      Show position before this move
                    </button>
                  </section>
                )}
              </>
            )}

            {tab === 'stats' && renderStats()}
          </div>
        </aside>
      </div>
    </div>
  );
}
