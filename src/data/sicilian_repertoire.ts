import type { OpeningLine } from '../lib/openingdb';

/**
 * Main-line move orders for White against the Sicilian, as SAN from the start position.
 * Every line was checked for legal moves with chess.js.
 */
export const SICILIAN_REPERTOIRE: OpeningLine[] = [
  { eco: 'Repertoire', name: 'Sicilian: Najdorf 6.h3 e6 7.g4 d5', moves: ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6', 'h3', 'e6', 'g4', 'd5', 'exd5', 'Nxd5', 'Nde2', 'Bb4'] },
  { eco: 'Repertoire', name: 'Sicilian: Najdorf 6.h3 e6 7.g4 b5', moves: ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6', 'h3', 'e6', 'g4', 'b5', 'Bg2', 'Bb7', 'O-O', 'Qc7', 'g5'] },
  { eco: 'Repertoire', name: 'Sicilian: Najdorf 6.h3 e6 7.g4 b5 9...b4', moves: ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6', 'h3', 'e6', 'g4', 'b5', 'Bg2', 'Bb7', 'O-O', 'b4', 'Nd5'] },
  { eco: 'Repertoire', name: 'Sicilian: Najdorf 6.h3 e6 7.g4 Nc6', moves: ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6', 'h3', 'e6', 'g4', 'Nc6', 'Be3', 'Be7', 'g5', 'Nd7', 'h4'] },
  { eco: 'Repertoire', name: 'Sicilian: Najdorf 6.h3 e6 7.g4 Nfd7', moves: ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6', 'h3', 'e6', 'g4', 'Nfd7', 'g5'] },
  { eco: 'Repertoire', name: 'Sicilian: Najdorf 6.h3 e6 7.g4 Be7', moves: ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6', 'h3', 'e6', 'g4', 'Be7', 'g5', 'Nfd7', 'h4', 'b5', 'a3', 'Bb7', 'Be3'] },
  { eco: 'Repertoire', name: 'Sicilian: Najdorf 6.h3 e6 7.g4 h6', moves: ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6', 'h3', 'e6', 'g4', 'h6', 'Bg2', 'Nc6', 'f4', 'Bd7', 'Be3'] },
  { eco: 'Repertoire', name: 'Sicilian: Najdorf 6.h3 e5', moves: ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6', 'h3', 'e5', 'Nde2', 'Be7', 'g4', 'Be6', 'Bg2'] },
  { eco: 'Repertoire', name: 'Sicilian: Najdorf 6.h3 e5 7...b5', moves: ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6', 'h3', 'e5', 'Nde2', 'b5', 'g4'] },
  { eco: 'Repertoire', name: 'Sicilian: Najdorf 6.h3 e5 7...Be6', moves: ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6', 'h3', 'e5', 'Nde2', 'Be6', 'g4', 'd5', 'exd5', 'Nxd5', 'Bg2'] },
  { eco: 'Repertoire', name: 'Sicilian: Najdorf 6.h3 e5 7...h5', moves: ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6', 'h3', 'e5', 'Nde2', 'h5', 'Bg5', 'Be6', 'Bxf6', 'Qxf6', 'Nd5'] },
  { eco: 'Repertoire', name: 'Sicilian: Najdorf 6.h3 Nc6', moves: ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6', 'h3', 'Nc6', 'g4', 'Nxd4', 'Qxd4', 'e5', 'Qd3', 'Be6', 'f4'] },
  { eco: 'Repertoire', name: 'Sicilian: Najdorf 5...e6 6.g4', moves: ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'e6', 'g4', 'e5', 'Bb5+', 'Bd7', 'Bxd7+', 'Qxd7', 'Nf5'] },
  { eco: 'Repertoire', name: 'Sicilian: Kan Variation (2...e6)', moves: ['e4', 'c5', 'Nf3', 'e6', 'd4', 'cxd4', 'Nxd4', 'a6', 'Nc3', 'b5', 'a3', 'Bb7', 'g3', 'Nf6', 'Bg2'] },
  { eco: 'Repertoire', name: 'Sicilian: Kan Variation 5...Qc7', moves: ['e4', 'c5', 'Nf3', 'e6', 'd4', 'cxd4', 'Nxd4', 'a6', 'Nc3', 'Qc7', 'g3', 'Bb4', 'Bd2', 'Nf6', 'Bg2', 'Nc6', 'Nb3'] },
  { eco: 'Repertoire', name: 'Sicilian: Taimanov Variation', moves: ['e4', 'c5', 'Nf3', 'e6', 'd4', 'cxd4', 'Nxd4', 'Nc6', 'Nc3', 'Qc7', 'g3', 'a6', 'Bg2', 'Nf6', 'O-O', 'd6', 'Re1'] },
  { eco: 'Repertoire', name: 'Sicilian: Classical Variation', moves: ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'Nc6', 'Bc4', 'e6', 'Be3', 'a6', 'Bb3', 'Na5', 'f4', 'b5', 'e5'] },
  { eco: 'Repertoire', name: 'Sicilian: Classical Variation 6...e6 7.Be3 Be7', moves: ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'Nc6', 'Bc4', 'e6', 'Be3', 'Be7', 'Bb3', 'O-O', 'f4', 'Na5', 'O-O'] },
  { eco: 'Repertoire', name: 'Sicilian: Dragon Variation', moves: ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'g6', 'Be3', 'Bg7', 'f3', 'O-O', 'Qd2', 'Nc6', 'O-O-O', 'Bd7', 'g4'] },
  { eco: 'Repertoire', name: 'Sicilian: Accelerated Dragon 5.c4', moves: ['e4', 'c5', 'Nf3', 'Nc6', 'd4', 'cxd4', 'Nxd4', 'g6', 'c4', 'Nf6', 'Nc3', 'd6', 'Be2', 'Nxd4', 'Qxd4', 'Bg7', 'Be3', 'O-O', 'Qd2'] },
  { eco: 'Repertoire', name: 'Sicilian: Sveshnikov Variation', moves: ['e4', 'c5', 'Nf3', 'Nc6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'e5', 'Ndb5', 'd6', 'Bg5', 'a6', 'Na3'] },
  { eco: 'Repertoire', name: 'Sicilian: Kalashnikov 2...Nc6 3.d4 cxd4 4.Nxd4 e5', moves: ['e4', 'c5', 'Nf3', 'Nc6', 'd4', 'cxd4', 'Nxd4', 'e5', 'Nb5', 'd6', 'c4', 'Be6', 'N1c3', 'a6', 'Na3'] },
  { eco: 'Repertoire', name: 'Sicilian: Four Knights Variation', moves: ['e4', 'c5', 'Nf3', 'e6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'Nc6', 'Ndb5', 'Bb4', 'a3', 'Bxc3+', 'Nxc3', 'd5', 'exd5', 'exd5', 'Bd3'] },
  { eco: 'Repertoire', name: 'Sicilian: Rare Sicilians 2...Nc6', moves: ['e4', 'c5', 'Nf3', 'Nc6', 'd4', 'cxd4', 'Nxd4', 'Qb6', 'Nb3', 'Nf6', 'Nc3', 'e6', 'Qe2'] },
  { eco: 'Repertoire', name: 'Sicilian: Rare Sicilians 2...Nf6', moves: ['e4', 'c5', 'Nf3', 'Nf6', 'Nc3', 'd5', 'exd5', 'Nxd5', 'Bb5+', 'Bd7', 'Ne5'] },
  { eco: 'Repertoire', name: 'Sicilian: Moscow 3...Bd7', moves: ['e4', 'c5', 'Nf3', 'd6', 'Bb5+', 'Bd7', 'd4', 'cxd4', 'Qxd4'] },
  { eco: 'Repertoire', name: 'Sicilian: Moscow 4...Qxd7', moves: ['e4', 'c5', 'Nf3', 'd6', 'Bb5+', 'Bd7', 'Bxd7+', 'Qxd7', 'O-O', 'Nf6', 'Qe2', 'Nc6', 'Rd1'] },
  { eco: 'Repertoire', name: 'Sicilian: Moscow 4...Nxd7', moves: ['e4', 'c5', 'Nf3', 'd6', 'Bb5+', 'Bd7', 'Bxd7+', 'Nxd7'] },
  { eco: 'Repertoire', name: 'Sicilian: Hybrid Variation', moves: ['e4', 'c5', 'Nf3', 'd6', 'Bb5+', 'Nc6', 'Bxc6+', 'bxc6'] },
  { eco: 'Repertoire', name: 'Sicilian: Rossolimo 3...g6', moves: ['e4', 'c5', 'Nf3', 'Nc6', 'Bb5', 'g6', 'Bxc6', 'bxc6'] },
  { eco: 'Repertoire', name: 'Sicilian: Rossolimo 3...g6', moves: ['e4', 'c5', 'Nf3', 'Nc6', 'Bb5', 'g6', 'Bxc6', 'dxc6', 'd3', 'Bg7', 'h3', 'Nf6'] },
  { eco: 'Repertoire', name: 'Sicilian: Rossolimo 3...e6', moves: ['e4', 'c5', 'Nf3', 'Nc6', 'Bb5', 'e6', 'Bxc6', 'dxc6'] },
  { eco: 'Repertoire', name: 'Sicilian: Rossolimo 3...e6 4...bxc6', moves: ['e4', 'c5', 'Nf3', 'Nc6', 'Bb5', 'e6', 'Bxc6', 'bxc6', 'b3'] },
  { eco: 'Repertoire', name: "Sicilian: King's Indian Attack with ...d5", moves: ['e4', 'c5', 'Nf3', 'e6', 'd3', 'd5', 'Nbd2', 'Nc6', 'g3', 'Nf6', 'Bg2', 'Be7', 'O-O', 'O-O'] },
  { eco: 'Repertoire', name: 'Sicilian: Other second moves', moves: ['e4', 'c5', 'Nf3', 'g6', 'd4', 'Bg7', 'c4'] },
];
