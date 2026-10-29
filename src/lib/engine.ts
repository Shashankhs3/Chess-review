import { Chess } from 'chess.js';

/**
 * Thin UCI wrapper around Stockfish running in a Web Worker.
 * Evaluations are normalised to White's point of view so callers never
 * have to care whose turn it was.
 *
 * Two modes share this class:
 *  - batch: `evaluate()` queues positions and resolves each one at a fixed depth.
 *  - live:  `watch()` searches one position indefinitely and streams the top lines.
 * Use a separate instance for each, so a live search never blocks batch work.
 */

/** Mate scores are encoded as ±(MATE_CP - moves) so "mate in N" survives the cp type. */
export const MATE_CP = 10000;

export type EvalResult = {
  /** Centipawns from White's point of view (mate encoded as described above). */
  cp: number;
  /** Best move in UCI notation, e.g. "e2e4" or "e7e8q". */
  bestMove: string;
  /** Depth the engine actually reached. */
  depth: number;
  /** Engine's principal variation in UCI, starting with `bestMove`. */
  pv: string[];
  /** White-POV eval of the second-best line, or null if there was only one legal move. */
  secondCp: number | null;
};

export type LiveLine = {
  /** Centipawns from White's point of view. */
  cp: number;
  depth: number;
  /** Principal variation in UCI. */
  pv: string[];
};

type Info = { depth: number; cp: number; pv: string[] };

type Job = {
  fen: string;
  depth: number;
  sideToMove: 'w' | 'b';
  lines: Map<number, Info>;
  resolve: (result: EvalResult) => void;
  reject: (error: Error) => void;
};

const LIVE_EMIT_INTERVAL_MS = 200;

export class StockfishEngine {
  private worker: Worker;
  private queue: Job[] = [];
  private current: Job | null = null;
  private ready: Promise<void>;
  private resolveReady!: () => void;

  private multiPv: number;
  private watchFen: string | null = null;
  private watchLines = new Map<number, LiveLine>();
  private watchCallback: ((lines: LiveLine[]) => void) | null = null;
  private lastEmit = 0;
  private emitTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(multiPv = 2) {
    this.multiPv = multiPv;
    this.ready = new Promise((resolve) => {
      this.resolveReady = resolve;
    });
    this.worker = new Worker(`${import.meta.env.BASE_URL}engine/stockfish-19-lite-single.js`);
    this.worker.onmessage = (event: MessageEvent) => this.handleLine(String(event.data));
    this.worker.onerror = (event: ErrorEvent) =>
      this.fail(new Error(event.message || 'Stockfish worker failed to load'));
    this.send('uci');
    this.send(`setoption name MultiPV value ${multiPv}`);
    this.send('isready');
  }

  /** Evaluates one position at a fixed depth. Jobs run one at a time, in order. */
  evaluate(fen: string, depth: number): Promise<EvalResult> {
    return new Promise((resolve, reject) => {
      const sideToMove = fen.split(' ')[1] === 'b' ? 'b' : 'w';
      this.queue.push({ fen, depth, sideToMove, lines: new Map(), resolve, reject });
      void this.ready.then(() => this.pump());
    });
  }

  /**
   * Searches `fen` until told otherwise, calling `onUpdate` with the top lines
   * as the search deepens. Calling again replaces the previous position.
   */
  watch(fen: string, onUpdate: (lines: LiveLine[]) => void) {
    void this.ready.then(() => {
      this.watchFen = fen;
      this.watchLines = new Map();
      this.watchCallback = onUpdate;
      this.send('stop');
      this.send(`position fen ${fen}`);
      this.send('go infinite');
    });
  }

  stopWatching() {
    this.watchFen = null;
    this.watchCallback = null;
    this.send('stop');
  }

  dispose() {
    this.stopWatching();
    if (this.emitTimer) clearTimeout(this.emitTimer);
    this.fail(new Error('Engine disposed'));
    this.worker.terminate();
  }

  private send(command: string) {
    this.worker.postMessage(command);
  }

  private pump() {
    if (this.current) return;
    const job = this.queue.shift();
    if (!job) return;
    this.current = job;
    this.send(`position fen ${job.fen}`);
    this.send(`go depth ${job.depth}`);
  }

  private handleLine(line: string) {
    if (line === 'readyok') {
      this.resolveReady();
      return;
    }
    if (line.startsWith('info ')) {
      this.handleInfo(line);
      return;
    }
    if (line.startsWith('bestmove')) {
      this.handleBestMove();
    }
  }

  private handleInfo(line: string) {
    // Bound-only scores are not exact evaluations.
    if (/ (upperbound|lowerbound)\b/.test(line)) return;
    const depthMatch = /\bdepth (\d+)/.exec(line);
    const scoreMatch = /\bscore (cp|mate) (-?\d+)/.exec(line);
    if (!depthMatch || !scoreMatch) return;

    const isWatching = this.watchFen !== null;
    const job = this.current;
    const sideToMove = isWatching ? (this.watchFen as string).split(' ')[1] : job?.sideToMove;
    if (!sideToMove) return;

    const value = Number(scoreMatch[2]);
    const sideToMoveCp =
      scoreMatch[1] === 'cp' ? value : value > 0 ? MATE_CP - value : -MATE_CP - value;
    const cp = sideToMove === 'w' ? sideToMoveCp : -sideToMoveCp;

    const pvMatch = / pv (.+)$/.exec(line);
    const pv = pvMatch ? pvMatch[1].trim().split(' ') : [];
    const depth = Number(depthMatch[1]);
    const lineIndex = Number(/\bmultipv (\d+)/.exec(line)?.[1] ?? 1);

    if (isWatching) {
      // Lines from a search that was just replaced can still arrive; drop any
      // whose first move is not legal in the position being watched.
      if (pv.length > 0 && !isLegalFirstMove(this.watchFen as string, pv[0])) return;
      this.watchLines.set(lineIndex, { cp, depth, pv });
      this.emitLive();
      return;
    }

    job?.lines.set(lineIndex, { depth, cp, pv });
  }

  private handleBestMove() {
    const job = this.current;
    if (!job) return; // e.g. the `stop` from a live search finishing
    this.current = null;
    const first = job.lines.get(1);
    const second = job.lines.get(2);
    job.resolve({
      cp: first?.cp ?? 0,
      bestMove: first?.pv[0] ?? '',
      depth: first?.depth ?? 0,
      pv: first?.pv ?? [],
      secondCp: second?.cp ?? null,
    });
    this.pump();
  }

  private emitLive() {
    if (!this.watchCallback) return;
    const since = Date.now() - this.lastEmit;
    if (since >= LIVE_EMIT_INTERVAL_MS) {
      this.flushLive();
    } else if (!this.emitTimer) {
      this.emitTimer = setTimeout(() => {
        this.emitTimer = null;
        this.flushLive();
      }, LIVE_EMIT_INTERVAL_MS - since);
    }
  }

  private flushLive() {
    this.lastEmit = Date.now();
    if (!this.watchCallback) return;
    const lines = [...this.watchLines.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, line]) => line)
      .slice(0, this.multiPv);
    this.watchCallback(lines);
  }

  private fail(error: Error) {
    this.current?.reject(error);
    this.current = null;
    for (const job of this.queue) job.reject(error);
    this.queue = [];
  }
}

function isLegalFirstMove(fen: string, uci: string): boolean {
  try {
    new Chess(fen).move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: uci.length > 4 ? uci[4] : undefined,
    });
    return true;
  } catch {
    return false;
  }
}
