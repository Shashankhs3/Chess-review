import { useMemo, useState, type CSSProperties } from 'react';
import { hintStyles } from '../lib/dots';
import { Chess, type Color, type Square } from 'chess.js';
import { Chessboard, type ChessboardOptions, type PositionDataType } from 'react-chessboard';
import { playSound, soundForSan } from '../lib/sound';
import { BOARD_COLORS } from '../lib/styles';

/**
 * Practice board. Two modes:
 *  - free:  any piece can be moved to any square, with no turn order and no rules.
 *           Pieces can also be placed from the palette or erased, to set up a position.
 *  - rules: standard chess. Only legal moves are allowed, and the sides alternate.
 *           "Play with rules" starts from the position on the free board.
 */

/** Square → piece code, e.g. { e1: 'wK', d8: 'bQ' }. */
type Board = Record<string, string>;
type Mode = 'free' | 'rules';

const START_FEN = new Chess().fen();

const PIECES: { code: string; glyph: string; name: string }[] = [
  { code: 'wK', glyph: '♔', name: 'White king' },
  { code: 'wQ', glyph: '♕', name: 'White queen' },
  { code: 'wR', glyph: '♖', name: 'White rook' },
  { code: 'wB', glyph: '♗', name: 'White bishop' },
  { code: 'wN', glyph: '♘', name: 'White knight' },
  { code: 'wP', glyph: '♙', name: 'White pawn' },
  { code: 'bK', glyph: '♚', name: 'Black king' },
  { code: 'bQ', glyph: '♛', name: 'Black queen' },
  { code: 'bR', glyph: '♜', name: 'Black rook' },
  { code: 'bB', glyph: '♝', name: 'Black bishop' },
  { code: 'bN', glyph: '♞', name: 'Black knight' },
  { code: 'bP', glyph: '♟', name: 'Black pawn' },
];

function boardFromFen(fen: string): Board {
  const board: Board = {};
  for (const cell of new Chess(fen).board().flat()) {
    if (cell) board[cell.square] = `${cell.color}${cell.type.toUpperCase()}`;
  }
  return board;
}

function positionOf(board: Board): PositionDataType {
  return Object.fromEntries(Object.entries(board).map(([square, piece]) => [square, { pieceType: piece }]));
}

/** FEN for the board with the chosen side to move. No castling or en passant (a setup position). */
function fenFromBoard(board: Board, turn: Color): string {
  const ranks: string[] = [];
  for (let rank = 8; rank >= 1; rank--) {
    let row = '';
    let empty = 0;
    for (const file of 'abcdefgh') {
      const piece = board[`${file}${rank}`];
      if (!piece) {
        empty++;
        continue;
      }
      if (empty) row += empty;
      empty = 0;
      const letter = piece[1];
      row += piece[0] === 'w' ? letter : letter.toLowerCase();
    }
    if (empty) row += empty;
    ranks.push(row);
  }
  return `${ranks.join('/')} ${turn} - - 0 1`;
}

const kingSquare = (board: Board, color: Color): Square | null => {
  const entry = Object.entries(board).find(([, piece]) => piece === `${color}K`);
  return (entry?.[0] as Square | undefined) ?? null;
};

export function PracticeBoard() {
  const [mode, setMode] = useState<Mode>('free');
  const [board, setBoard] = useState<Board>(() => boardFromFen(START_FEN));
  const [sideToMove, setSideToMove] = useState<Color>('w');
  const [palette, setPalette] = useState<string | null>(null);
  const [eraser, setEraser] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Rules mode: the square of the piece picked up by a click; its moves are shown as dots.
  const [picked, setPicked] = useState<string | null>(null);

  // Rules mode state: the current FEN and the FENs before each move, for undo.
  const [rulesFen, setRulesFen] = useState(START_FEN);
  const [history, setHistory] = useState<string[]>([]);

  const rulesGame = useMemo(() => new Chess(rulesFen), [rulesFen]);

  const status = useMemo(() => {
    if (mode !== 'rules') return null;
    const turn = rulesGame.turn() === 'w' ? 'White' : 'Black';
    if (rulesGame.isCheckmate()) return `Checkmate. ${rulesGame.turn() === 'w' ? 'Black' : 'White'} wins.`;
    if (rulesGame.isStalemate()) return 'Stalemate. Draw.';
    if (rulesGame.isDraw()) return 'Draw.';
    return rulesGame.isCheck() ? `${turn} to move, and is in check.` : `${turn} to move.`;
  }, [mode, rulesGame]);

  function startRules() {
    const fen = fenFromBoard(board, sideToMove);
    const notMoving: Color = sideToMove === 'w' ? 'b' : 'w';
    if (!kingSquare(board, 'w') || !kingSquare(board, 'b')) {
      setError('Each side needs a king before the rules can start.');
      return;
    }
    if (Object.values(board).filter((p) => p === 'wK').length > 1 || Object.values(board).filter((p) => p === 'bK').length > 1) {
      setError('Each side can have only one king.');
      return;
    }
    const checker = new Chess(fen);
    const king = kingSquare(board, notMoving);
    if (king && checker.isAttacked(king, sideToMove)) {
      setError('The side that is not to move is in check, so this position cannot occur.');
      return;
    }
    setError(null);
    setRulesFen(fen);
    setPicked(null);
    setHistory([]);
    setMode('rules');
  }

  function backToFree() {
    setBoard(boardFromFen(rulesFen));
    setSideToMove(rulesGame.turn());
    setMode('free');
    setPicked(null);
    setError(null);
  }

  function undoMove() {
    const previous = history[history.length - 1];
    if (!previous) return;
    setRulesFen(previous);
    setHistory((h) => h.slice(0, -1));
  }

  // Free mode: any move, no legality checks. Captures simply replace the piece.
  const freeDrop = ({ sourceSquare, targetSquare }: { sourceSquare: string; targetSquare: string | null }) => {
    if (!targetSquare || targetSquare === sourceSquare) return false;
    setBoard((b) => {
      const piece = b[sourceSquare];
      if (!piece) return b;
      const next = { ...b };
      delete next[sourceSquare];
      next[targetSquare] = piece;
      return next;
    });
    return true;
  };

  // Rules mode: only legal moves are accepted, and the turn passes to the other side.
  const rulesDrop = ({ sourceSquare, targetSquare }: { sourceSquare: string; targetSquare: string | null }) => {
    if (!targetSquare) return false;
    const game = new Chess(rulesFen);
    const piece = game.get(sourceSquare as Square);
    const promotion = piece?.type === 'p' && (targetSquare[1] === '8' || targetSquare[1] === '1') ? 'q' : undefined;
    let made;
    try {
      made = game.move({ from: sourceSquare, to: targetSquare, promotion });
    } catch {
      playSound('illegal');
      return false;
    }
    playSound(soundForSan(made.san));
    setHistory((h) => [...h, rulesFen]);
    setRulesFen(game.fen());
    return true;
  };

  // Dots show where the picked piece can move in rules mode.
  const ruleStyles = useMemo(() => {
    const styles: Record<string, CSSProperties> = {};
    if (picked) styles[picked] = { backgroundColor: 'rgba(120, 170, 255, 0.55)' };
    for (const [target, hint] of Object.entries(hintStyles(rulesFen, picked))) {
      styles[target] = { ...styles[target], ...hint };
    }
    return styles;
  }, [rulesFen, picked]);

  const options: ChessboardOptions = {
    position: mode === 'free' ? positionOf(board) : rulesFen,
    squareStyles: mode === 'rules' ? ruleStyles : {},
    boardOrientation: 'white',
    allowDragging: true,
    animationDurationInMs: 120,
    lightSquareStyle: { backgroundColor: BOARD_COLORS.light },
    darkSquareStyle: { backgroundColor: BOARD_COLORS.dark },
    clearArrowsOnPositionChange: true,
    onPieceDrop: mode === 'free' ? freeDrop : rulesDrop,
    onSquareClick: ({ square }) => {
      if (mode === 'rules') {
        // Click a piece to see its moves, then click a dot to play it.
        if (picked === square) {
          setPicked(null);
          return;
        }
        if (picked && rulesDrop({ sourceSquare: picked, targetSquare: square })) {
          setPicked(null);
          return;
        }
        setPicked(rulesGame.get(square as Square) ? square : null);
        return;
      }
      if (eraser) {
        setBoard((b) => {
          const next = { ...b };
          delete next[square];
          return next;
        });
      } else if (palette) {
        setBoard((b) => ({ ...b, [square]: palette }));
      }
    },
  };

  return (
    <div className="practice">
      <div className="practice-board">
        <Chessboard options={options} />
      </div>

      <aside className="card practice-panel">
        {mode === 'free' ? (
          <>
            <h3>Free board</h3>
            <p className="hint small">
              Drag any piece anywhere, with no turn order and no rules. Use the palette to place pieces, or the eraser to
              remove them, then start the rules when the position is ready.
            </p>

            <div className="palette" role="group" aria-label="Pieces">
              {PIECES.map((piece) => (
                <button
                  key={piece.code}
                  className={`piece-btn ${palette === piece.code ? 'active' : ''}`}
                  title={piece.name}
                  aria-label={piece.name}
                  onClick={() => {
                    setEraser(false);
                    setPalette(palette === piece.code ? null : piece.code);
                  }}
                >
                  {piece.glyph}
                </button>
              ))}
            </div>
            <div className="practice-tools">
              <button
                className={eraser ? 'active' : ''}
                onClick={() => {
                  setPalette(null);
                  setEraser((e) => !e);
                }}
              >
                Eraser
              </button>
              <button onClick={() => setBoard({})}>Clear board</button>
              <button onClick={() => setBoard(boardFromFen(START_FEN))}>Starting position</button>
            </div>

            <div className="side-choice" role="radiogroup" aria-label="Side to move">
              <span className="hint">Side to move:</span>
              <button className={sideToMove === 'w' ? 'active' : ''} onClick={() => setSideToMove('w')}>
                White
              </button>
              <button className={sideToMove === 'b' ? 'active' : ''} onClick={() => setSideToMove('b')}>
                Black
              </button>
            </div>

            {error && <p className="error small">{error}</p>}
            <button className="primary" onClick={startRules}>
              Next: play with the rules →
            </button>
          </>
        ) : (
          <>
            <h3>Rules on</h3>
            <p className="hint small">Only legal moves are allowed, and the sides take turns.</p>
            <p className="status">{status}</p>
            <div className="practice-tools">
              <button onClick={undoMove} disabled={history.length === 0}>
                Undo move
              </button>
              <button onClick={backToFree}>Back to free board</button>
            </div>
          </>
        )}
      </aside>
    </div>
  );
}
