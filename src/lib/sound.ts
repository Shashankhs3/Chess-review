/**
 * Move sounds, generated with the Web Audio API so no audio files are needed.
 *
 * They are modelled on a wooden piece touching a board: a very short filtered noise
 * "tick" for the contact, plus a brief low resonance for the body of the board. Captures
 * are heavier, checks are a little sharper. Each clack gets a tiny random pitch change, so
 * repeated moves don't sound identical.
 */

export type SoundKind = 'move' | 'capture' | 'check' | 'castle' | 'promotion' | 'mate' | 'illegal';

const KEY = 'chess-review.sound.v1';

export function soundEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
}

export function setSoundEnabled(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off');
  } catch {
    // Storage blocked: the setting lasts for this visit only.
  }
}

let context: AudioContext | null = null;
let noise: AudioBuffer | null = null;

function audio(): AudioContext | null {
  if (!context) {
    try {
      context = new AudioContext();
    } catch {
      return null;
    }
  }
  if (context.state === 'suspended') void context.resume();
  return context;
}

/** One second of white noise, made once and reused for every click. */
function noiseBuffer(c: AudioContext): AudioBuffer {
  if (!noise || noise.sampleRate !== c.sampleRate) {
    noise = c.createBuffer(1, c.sampleRate, c.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  return noise;
}

/** A few percent of random pitch variation, so the same move never sounds exactly the same. */
const jitter = (freq: number) => freq * (1 + (Math.random() - 0.5) * 0.06);

/**
 * The contact: a very short burst of band-passed noise. The band and length set how
 * "wooden" and how heavy the piece sounds.
 */
function contact(c: AudioContext, at: number, opts: { band: number; q: number; length: number; volume: number }) {
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c);
  const filter = c.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = jitter(opts.band);
  filter.Q.value = opts.q;
  const gain = c.createGain();
  gain.gain.setValueAtTime(opts.volume, at);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + opts.length);
  src.connect(filter).connect(gain).connect(c.destination);
  src.start(at);
  src.stop(at + opts.length + 0.01);
}

/**
 * The body: the wooden board ringing. A few inharmonic partials decay at different rates, which
 * is what makes wood sound like wood rather than a pure beep. Each partial rings for `length`
 * seconds, and the lower ones ring longer.
 */
function body(c: AudioContext, at: number, opts: { freq: number; length: number; volume: number }) {
  const partials = [
    { ratio: 1, level: 1, decay: 1 },
    { ratio: 2.32, level: 0.45, decay: 0.7 },
    { ratio: 3.87, level: 0.2, decay: 0.45 },
  ];
  for (const p of partials) {
    const osc = c.createOscillator();
    const gain = c.createGain();
    const freq = jitter(opts.freq) * p.ratio;
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq * 1.12, at);
    osc.frequency.exponentialRampToValueAtTime(freq, at + 0.01);
    const length = opts.length * p.decay;
    gain.gain.setValueAtTime(opts.volume * p.level, at);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
    osc.connect(gain).connect(c.destination);
    osc.start(at);
    osc.stop(at + length + 0.01);
  }
}

/** A normal piece landing on the board. */
function clack(c: AudioContext, at: number, volume = 1) {
  contact(c, at, { band: 2600, q: 1.4, length: 0.02, volume: 0.9 * volume });
  body(c, at, { freq: 190, length: 0.05, volume: 0.35 * volume });
}

/**
 * A capture is two events: the capturing piece lands, then a moment later the captured piece is
 * knocked off the square. The second knock is heavier, rolls slightly, and has a small rattle
 * from the piece tipping on the board.
 */
function thud(c: AudioContext, at: number, volume = 1) {
  // The capturing piece lands.
  contact(c, at, { band: 2200, q: 1.2, length: 0.025, volume: 0.95 * volume });
  body(c, at, { freq: 150, length: 0.07, volume: 0.35 * volume });

  // The captured piece is knocked off, a little later and lower.
  const knock = at + 0.045 + Math.random() * 0.01;
  contact(c, knock, { band: 1100, q: 0.9, length: 0.05, volume: 1.1 * volume });
  body(c, knock, { freq: 105, length: 0.14, volume: 0.5 * volume });

  // A short rattle as the piece settles.
  for (let i = 0; i < 3; i++) {
    contact(c, knock + 0.03 + i * (0.012 + Math.random() * 0.006), {
      band: 2800 + Math.random() * 600,
      q: 2,
      length: 0.008,
      volume: 0.25 * volume * (1 - i * 0.25),
    });
  }
}

/** A slightly brighter clack, for a check. */
function sharp(c: AudioContext, at: number) {
  contact(c, at, { band: 3300, q: 1.8, length: 0.018, volume: 0.85 });
  body(c, at, { freq: 230, length: 0.045, volume: 0.3 });
}

/** A quiet, dull knock for an illegal move. */
function knock(c: AudioContext, at: number) {
  contact(c, at, { band: 700, q: 0.9, length: 0.05, volume: 0.5 });
  body(c, at, { freq: 110, length: 0.08, volume: 0.25 });
}

export function playSound(kind: SoundKind): void {
  if (!soundEnabled()) return;
  const c = audio();
  if (!c) return;
  const t = c.currentTime + 0.005;
  switch (kind) {
    case 'move':
      clack(c, t);
      break;
    case 'capture':
      thud(c, t);
      break;
    case 'castle':
      // The king moves, then the rook: two clacks in quick succession.
      clack(c, t, 0.9);
      clack(c, t + 0.13, 0.9);
      break;
    case 'check':
      sharp(c, t);
      break;
    case 'promotion':
      // A clack, then a faint higher ring for the new piece.
      clack(c, t);
      body(c, t + 0.06, { freq: 880, length: 0.3, volume: 0.06 });
      break;
    case 'mate':
      // A check-style clack, then a heavy final thud.
      sharp(c, t);
      thud(c, t + 0.2, 1.1);
      break;
    case 'illegal':
      knock(c, t);
      break;
  }
}

/** Which sound a move makes, from its SAN ("Nxe5+", "O-O", "e8=Q#", ...). */
export function soundForSan(san: string): SoundKind {
  if (san.includes('#')) return 'mate';
  if (san.startsWith('O-O')) return 'castle';
  if (san.includes('=')) return 'promotion';
  if (san.includes('+')) return 'check';
  if (san.includes('x')) return 'capture';
  return 'move';
}
