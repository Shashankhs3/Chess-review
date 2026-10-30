# Chess Review

A browser app that loads your recent chess.com games and analyses them with
Stockfish (WASM, runs entirely in your browser — no server).

## Run

```bash
npm install
npm run dev
```

Open http://localhost:5173, enter a chess.com username, pick a time range and
engine depth, then click a game.

## How it works

- `src/lib/chesscom.ts` — reads the public chess.com archives API.
- `src/lib/engine.ts` — runs `public/engine/stockfish-19-lite-single.js` in a Web Worker over UCI.
- `src/lib/analysis.ts` — evaluates every position, computes win-% loss per move,
  classifies moves (best / good / inaccuracy / mistake / blunder) and accuracy.
- `src/App.tsx` — board, eval bar, move list, and the "where you lost ground" panel.

## Caveats

- Accuracy uses the Lichess win-% curve. chess.com's accuracy formula and move
  classifications are proprietary, so numbers will differ somewhat from chess.com.
- Depth 14 is fast; depth 18+ gives stronger suggestions but takes longer per game.

## Coaching

- **Opening name** — matched against 3,865 ECO openings (lichess-org/chess-openings, CC0,
  in `src/data/openings.json`). Shows the game's opening and the opening at each mistake.
- **Why the suggested move works** (`src/lib/coach.ts`, `reasonsFor`) — rule-based: checks,
  mates, captures, promotions, castling, saving an attacked piece, attacking an undefended
  piece, development, central pawns/knights. Plus the engine's principal variation.
- **What the mistake allowed** — the opponent's best reply after your move (mate, a capture),
  and any of your pieces left undefended.
- **Missed trap** — the opponent blundered or made a mistake and your next move didn't
  punish it; the punishing move is shown.
- **Missed mate** — you had a forced mate and didn't play it.

The explanations are heuristics built from the position and the engine's line. They are not
a language model, so they can miss subtle strategic reasons.

## Live engine and key moments

- **Live engine** (`src/components/LivePanel.tsx`) — a second Stockfish instance searches
  the current position continuously and shows the top 3 lines with evals and the best move.
  The board arrows follow it (green = best, blue = second).
- **Eval graph** — white's winning chances across the game; click to jump. Coloured dots
  mark notable moves.
- **Classifications** — brilliant (!!), great (!), best, good, inaccuracy (?!), mistake (?),
  blunder (??). Great means the second-best line is at least 15% worse in win chance.
  Brilliant means a best move that gives up at least 2 points of material and still
  leaves the mover clearly ahead. These are heuristics.
- **Key moments** — only notable moves are listed (the move list keeps every move for
  navigation, and marks only the notable ones). Missed tactics are tagged: the engine's
  best move was a capture, check or promotion that you didn't play.
- **Missed traps** — the opponent erred and you didn't punish it.

## Layout and playing on the board

- The window never scrolls as a whole: games on the left, board in the middle, analysis on
  the right. Each card scrolls on its own. On narrow screens the page stacks normally.
- **Play moves** by dragging a piece or clicking it and then its target square. Pawns
  promote to a queen automatically.
- **Variations:** playing a move that differs from the game's move (or from an earlier
  variation) starts a new branch. Moves you play inside a branch extend it. The Moves tab
  lists branches; click one to jump to its end. "Back to branch point" returns to the game.
- The live engine evaluates whatever position is on the board, including variations.
  Variations get live evaluations only, not the full batch analysis or classifications.

## Classification (chess.com-style) and how close it is

Thresholds are on win-% lost by the mover, following chess.com's published expected-points
bands (Excellent ≤ 2, Good ≤ 5, Inaccuracy ≤ 10, Mistake ≤ 20, Blunder > 20 on the expected
points scale, read here as win-% points). Sources:
- chess.com support, "How are moves classified": https://support.chess.com/en/articles/8572705-how-are-moves-classified-what-is-a-blunder-or-brilliant-move
- Lichess accuracy page: https://www.lichess.org/page/accuracy

Classes: brilliant (!!), great (!), best, excellent, good, inaccuracy (?!), mistake (?),
miss (a winning tactic was left on the board), blunder (??). A blunder that turns a winning
position into an equal or losing one is flagged in the coach card.

Known differences from chess.com (checked on one game, professorllama vs b3yond_c):
- Accuracy: ours 91–93% against chess.com's 82.3% for the same player. chess.com's accuracy
  formula is not public, so this tool does not try to copy it.
- Counts are close but not identical. Depth 14 and 18 both move a few classes by one.
- Opening book moves are not recognised, so Best and Excellent counts differ.

## Saved games, stats and suggestions

- **Analyse last 20 / 50** (left panel) fetches your most recent games across months, analyses
  each one in turn, and keeps a compact record in this browser's local storage. Games already
  saved are skipped. Cancel stops after the current game.
- Every game you open is saved automatically.
- **Stats tab** filters by time control (bullet, blitz, rapid, daily) and by the last 20, 50 or
  all saved games. It shows results, accuracy (ours and chess.com's where chess.com reported
  one), errors per game, accuracy and errors by phase (opening, middlegame, endgame), and
  accuracy by time control.
- **Where to improve** gives up to three rule-based suggestions, each quoting your own numbers.
  Rules are in `src/lib/stats.ts` (`suggestions`). They need at least 5 saved games.
- **chess.com accuracy** comes from the public API's `accuracies` field, present only for games
  chess.com has reviewed. Our estimate is shown separately.
- Storage is limited to 300 games and is kept only in this browser. Clearing site data, or
  using another browser or device, removes them.
- **Speed:** analysis now spreads positions over several Stockfish workers, and the Fast preset
  is depth 12 (was 10). Standard is depth 16 and Deep is depth 20. Time per game depends on your CPU.

## Opening trainer

Drill opening lines the way the popular repertoire trainers do (Chessdriller, En Croissant, Listudy): spaced repetition.

- Choose a line from the Sicilian repertoire, from the lines you saved in Opening prep, or search any opening by name or ECO.
- The opponent's moves are played for you; you find yours, by dragging or by clicking a piece and then a dot.
- A wrong move is rejected with feedback. After two wrong tries, or on Hint, the book move is shown on the board.
- A clean run moves the line up a box (due again in 1, 3, 7, 14, then 30 days). A run with slips moves it down, so it returns sooner.
- Progress is kept in this browser only.
