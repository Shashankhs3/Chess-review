import { useEffect, useRef, useState } from 'react';
import { formatEval } from '../lib/analysis';
import { formatSanLine, lineToSan } from '../lib/coach';
import { StockfishEngine, type LiveLine } from '../lib/engine';

type Props = {
  fen: string;
  /** Receives the latest top lines together with the position they belong to. */
  onLines: (lines: LiveLine[], forFen: string) => void;
};

/** Searches the current position continuously and shows the top engine lines. */
export function LivePanel({ fen, onLines }: Props) {
  const engineRef = useRef<StockfishEngine | null>(null);
  const [lines, setLines] = useState<LiveLine[]>([]);

  // One engine per mounted panel; a separate instance from batch analysis.
  useEffect(() => {
    const engine = new StockfishEngine(3);
    engineRef.current = engine;
    return () => {
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    setLines([]);
    onLines([], fen);
    engine.watch(fen, (next) => {
      setLines(next);
      onLines(next, fen);
    });
  }, [fen, onLines]);

  const top = lines[0];
  const bestSan = top ? lineToSan(fen, top.pv, 1)[0] : '';

  return (
    <section className="live">
      <div className="live-head">
        <h3>Live engine</h3>
        <span className="hint">{top ? `depth ${top.depth}` : 'thinking…'}</span>
      </div>
      {top && (
        <p className="live-best">
          Best: <b>{bestSan}</b> <span className="eval-pill">{formatEval(top.cp)}</span>
        </p>
      )}
      <ol className="live-lines">
        {lines.map((line, i) => {
          const san = lineToSan(fen, line.pv, 10);
          return (
            <li key={i}>
              <span className="eval-pill">{formatEval(line.cp)}</span>
              <span className="pv">{formatSanLine(fen, san)}</span>
            </li>
          );
        })}
      </ol>
      <p className="hint small">Evaluations are from White's point of view.</p>
    </section>
  );
}
