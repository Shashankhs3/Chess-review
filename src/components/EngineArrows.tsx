import type { Arrow } from 'react-chessboard';

/** An arrow, optionally wider than the default, so it still shows when another arrow sits on it. */
export type OverlayArrow = Arrow & { width?: number };

type Props = {
  arrows: OverlayArrow[];
  /** Black at the bottom: mirror the squares, as the board itself does. */
  flipped: boolean;
};

const DEFAULT_WIDTH = 0.14;

const fileIndex = (square: string) => square.charCodeAt(0) - 97;
const rankIndex = (square: string) => Number(square[1]) - 1;

/** Centre of a square in a 0–8 grid, with White at the bottom unless the board is flipped. */
function centre(square: string, flipped: boolean) {
  const file = fileIndex(square);
  const rank = rankIndex(square);
  return flipped ? { x: 7 - file + 0.5, y: rank + 0.5 } : { x: file + 0.5, y: 7 - rank + 0.5 };
}

/**
 * Engine suggestions drawn as an overlay that React controls completely. The board library keeps
 * its own arrow state, which could keep old arrows on the board after the position changed.
 * Here every arrow comes straight from the current props, so nothing can be left behind.
 */
export function EngineArrows({ arrows, flipped }: Props) {
  return (
    <svg className="engine-arrows" viewBox="0 0 8 8" aria-hidden="true">
      {arrows.map((arrow, i) => {
        const width = arrow.width ?? DEFAULT_WIDTH;
        const from = centre(arrow.startSquare, flipped);
        const to = centre(arrow.endSquare, flipped);
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const length = Math.hypot(dx, dy) || 1;
        const ux = dx / length;
        const uy = dy / length;
        // The shaft stops short of the target so the head sits on the square's centre.
        const headLength = 0.28 * (width / DEFAULT_WIDTH);
        const base = { x: to.x - ux * headLength, y: to.y - uy * headLength };
        const side = { x: -uy * width * 1.15, y: ux * width * 1.15 };
        const head = `${to.x},${to.y} ${base.x + side.x},${base.y + side.y} ${base.x - side.x},${base.y - side.y}`;
        return (
          <g key={`${arrow.startSquare}${arrow.endSquare}-${i}`} style={{ color: arrow.color }}>
            <line
              x1={from.x}
              y1={from.y}
              x2={base.x}
              y2={base.y}
              stroke={arrow.color}
              strokeWidth={width}
              strokeLinecap="round"
            />
            <polygon points={head} fill={arrow.color} />
          </g>
        );
      })}
    </svg>
  );
}
