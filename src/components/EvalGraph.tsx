import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { isNotable, winPercent, type GameAnalysis } from '../lib/analysis';
import { COLORS } from '../lib/styles';

const HEIGHT = 70;

type Props = {
  analysis: GameAnalysis;
  /** Position currently shown on the board, or -1 when a variation is showing. */
  ply: number;
  onSelect: (ply: number) => void;
};

/**
 * Lichess-style evaluation graph: white's winning chances over the whole game.
 * It measures its own width and draws at real pixel size, so lines and dots stay sharp.
 */
export function EvalGraph({ analysis, ply, onSelect }: Props) {
  const ref = useRef<SVGSVGElement>(null);
  const [width, setWidth] = useState(600);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setWidth(Math.max(200, Math.round(el.getBoundingClientRect().width)));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const { line, area, dots } = useMemo(() => {
    const count = analysis.evals.length;
    const xAt = (i: number) => (count <= 1 ? 0 : (i / (count - 1)) * width);
    const yAt = (cp: number) => HEIGHT * (1 - winPercent(cp) / 100);

    const points = analysis.evals.map((cp, i) => `${xAt(i).toFixed(1)},${yAt(cp).toFixed(1)}`);
    const line = `M ${points.join(' L ')}`;
    const area = `${line} L ${width},${HEIGHT} L 0,${HEIGHT} Z`;

    const dots = analysis.moves.flatMap((move, index) => {
      if (!isNotable(move.classification)) return [];
      const i = index + 1;
      return [{ x: xAt(i), y: yAt(analysis.evals[i]), color: COLORS[move.classification], ply: i }];
    });
    return { line, area, dots };
  }, [analysis, width]);

  const handleClick = (event: MouseEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const fraction = (event.clientX - rect.left) / rect.width;
    const count = analysis.evals.length;
    onSelect(Math.round(Math.min(1, Math.max(0, fraction)) * (count - 1)));
  };

  const count = analysis.evals.length;
  const cursorX = count <= 1 ? 0 : (ply / (count - 1)) * width;

  return (
    <svg
      ref={ref}
      className="eval-graph"
      width="100%"
      height={HEIGHT}
      viewBox={`0 0 ${width} ${HEIGHT}`}
      onClick={handleClick}
      role="img"
      aria-label="Evaluation graph; click to jump to a move"
    >
      <rect className="eg-black" width={width} height={HEIGHT} />
      <path className="eg-white" d={area} />
      <line className="eg-mid" x1={0} x2={width} y1={HEIGHT / 2} y2={HEIGHT / 2} strokeDasharray="4 4" />
      <path className="eg-line" d={line} fill="none" strokeWidth={1.25} strokeLinejoin="round" />
      {ply >= 0 && <line className="eg-cursor" x1={cursorX} x2={cursorX} y1={0} y2={HEIGHT} strokeWidth={2} />}
      {dots.map((dot) => (
        <circle className="eg-dot" key={dot.ply} cx={dot.x} cy={dot.y} r={4} fill={dot.color} strokeWidth={1} />
      ))}
    </svg>
  );
}
