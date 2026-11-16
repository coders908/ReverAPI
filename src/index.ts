import readline from "node:readline";
import type { ChatProvider, ChatEvent } from "../providers/types.js";
import { DEFAULT_MODEL, MODELS, type ModelEntry } from "./models.js";
import {
  describeError,
  proxyLabel,
  setProxyReporter,
  type ProxyUsage,
} from "./proxy.js";


const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const ITALIC = "\x1b[3m";
const UNDERLINE = "\x1b[4m";

const fg = (n: number) => `\x1b[38;5;${n}m`;

const C = {
  text: fg(252),
  mute: fg(244),
  faint: fg(238),
  red: fg(203),
  green: fg(114),
  yellow: fg(221),
  cyan: fg(81),
  violet: fg(177),
};

type RGB = [number, number, number];

const STOPS: RGB[] = [
  [34, 211, 238],
  [56, 132, 255],
  [139, 92, 246],
  [232, 121, 249],
  [251, 113, 133],
];

function mix(a: RGB, b: RGB, t: number): RGB {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

function sample(t: number): RGB {
  const n = STOPS.length - 1;
  const x = Math.min(0.9999, Math.max(0, t)) * n;
  const i = Math.floor(x);
  return mix(STOPS[i], STOPS[i + 1], x - i);
}

const rgbFg = (c: RGB) => `\x1b[38;2;${c[0]};${c[1]};${c[2]}m`;

function gradient(text: string, t0 = 0, t1 = 1): string {
  const chars = [...text];
  const last = Math.max(1, chars.length - 1);
  let out = "";
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (ch === " ") {
      out += ch;
      continue;
    }
    out += rgbFg(sample(t0 + ((t1 - t0) * i) / last)) + ch;
  }
  return out + RESET;
}


const ART_RAW = `
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢠⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢸⣧⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣿⣷⣄⡀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢀⡔⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠭⣿⣿⣿⣶⣄⣀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣀⣴⣾⡿⠁⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠘⡿⣿⡿⣿⣿⣿⣿⣦⣴⣶⣶⣶⣶⣦⣤⣤⣀⣀⠀⠀⠀⠀⠀⢀⣀⣤⣲⣿⣿⣿⠟⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠐⡝⢿⣌⠿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣷⣶⣤⣾⣿⣿⣿⣿⣿⡿⠃⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠈⠲⡝⡷⣮⣝⣻⢿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣛⣿⣿⠿⠃⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢀⣴⣿⣦⣝⠓⠭⣿⡿⢿⣿⣿⣛⠻⣿⠿⠿⣿⣿⣿⣿⣿⣿⡿⣇⣇⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢀⣴⣿⣿⣿⣿⣿⣿⣤⡀⠈⠉⠚⠺⣿⠯⢽⣿⣷⣄⣶⣷⢾⣿⣯⣾⣿⠿⠃⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢠⣾⣿⣿⣿⣿⣿⣿⣿⣿⣧⠀⠀⠀⠀⡟⠀⠀⣴⣿⣿⣼⠈⠉⠃⠋⢹⠁⢀⡇⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢠⢿⣿⡟⣿⣿⣿⣿⣿⣿⣿⣿⣷⣄⣀⣀⣀⣀⣴⣿⣿⡿⣿⠀⠀⠀⠀⠇⠀⣼⡇⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠈⠑⢿⢿⣾⣿⣿⡿⠿⠿⠿⢿⣿⣿⣿⣿⣿⣿⣿⣿⠟⠿⢿⡄⢦⣤⣤⣶⣿⣿⣷⡀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠙⠘⠛⠋⠁⠁⣀⢉⡉⢻⡻⣯⣻⣿⢻⣿⣀⠀⠀⠀⢠⣾⣿⣿⣿⣹⠉⣍⢁⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣀⠠⠔⠒⠋⠀⡈⠀⠠⠤⠀⠓⠯⣟⣻⣻⠿⠛⠁⠀⠀⠣⢽⣿⡻⠿⠋⠰⠤⣀⡈⠒⢄⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⡀⠔⠊⠁⠀⣀⠔⠈⠁⠀⠀⠀⠀⠀⣶⠂⠀⠀⠀⢰⠆⠀⠀⠀⠈⠒⢦⡀⠉⠢⠀⠁⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠊⠀⠀⠀⠀⠎⠁⠀⠀⠀⠀⠀⠀⠀⠀⠋⠀⠀⠀⠰⠃⠀⠀⠀⠀⠀⠀⠀⠈⠂⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣸⣄⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢸⣿⣿⣿⣿⣿⣿⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠸⠿⠭⠯⠭⠽⠿⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
`.split("\n");

/** Braille blank and space behave as transparent pixels in the drawing. */
const isBlankChar = (ch: string) => ch === "⠀" || ch === " ";

const isBlankRow = (line: string) => [...line].every(isBlankChar);

/** Drops the empty padding so the drawing can sit next to other art. */
function trimArt(rows: string[]): string[] {
  let firstColumn = Number.POSITIVE_INFINITY;
  let lastColumn = -1;

  for (const row of rows) {
    [...row].forEach((char, index) => {
      if (isBlankChar(char)) return;
      firstColumn = Math.min(firstColumn, index);
      lastColumn = Math.max(lastColumn, index);
    });
  }
  if (lastColumn < 0) return rows;

  return rows.map((row) => [...row].slice(firstColumn, lastColumn + 1).join(""));
}

const ART = (() => {
  const first = ART_RAW.findIndex((line) => !isBlankRow(line));
  const last = ART_RAW.length - [...ART_RAW].reverse().findIndex((line) => !isBlankRow(line));
  return trimArt(ART_RAW.slice(first, last));
})();


/** Block letters for the wordmark: every glyph is five columns wide. */
const BLOCK_GLYPHS: Record<string, string[]> = {
  R: ["████ ", "█   █", "████ ", "█  █ ", "█   █"],
  E: ["█████", "█    ", "████ ", "█    ", "█████"],
  V: ["█   █", "█   █", "█   █", " █ █ ", "  █  "],
  A: [" ███ ", "█   █", "█████", "█   █", "█   █"],
  P: ["████ ", "█   █", "████ ", "█    ", "█    "],
  I: ["█████", "  █  ", "  █  ", "  █  ", "█████"],
};

const BLOCK_ROWS = 5;

/** `REVERAPI` drawn large, one row per visual line. */
function buildWordmark(word: string): string[] {
  const rows: string[] = [];
  for (let row = 0; row < BLOCK_ROWS; row += 1) {
    rows.push([...word].map((letter) => BLOCK_GLYPHS[letter]?.[row] ?? "     ").join(" "));
  }
  return rows;
}

const WORDMARK = buildWordmark("REVERAPI");

const W = 74;
const PAD = 2;

const ANSI = /\x1b\[[0-9;]*m/g;

/** Length as the terminal sees it: colouring codes take no room. */
const visibleLength = (text: string): number => [...text.replace(ANSI, "")].length;

function center(text: string, width = W): string {
  const left = Math.max(PAD, Math.floor((width - visibleLength(text)) / 2));
  return " ".repeat(left) + text;
}

const rule = (width = W, t0 = 0, t1 = 1) => gradient("─".repeat(width), t0, t1);


const HERO_GAP = 4;

interface Hero {
  /** plain text rows, all the same width */
  rows: string[];
  width: number;
  /** what the rest of the header should match in width */
  headerWidth: number;
}

const padRow = (row: string, width: number): string => {
  const missing = width - [...row].length;
  return missing > 0 ? row + " ".repeat(missing) : row;
};

/**
 * Terminal width, falling back to `COLUMNS` when stdout is not a TTY (pipes,
 * CI logs), so the lockup keeps its side-by-side form there too.
 */
function terminalColumns(): number {
  return process.stdout.columns ?? Number(process.env.COLUMNS) ?? 0;
}

/**
 * Lays the mark and the wordmark out as one lockup. A wide terminal gets them
 * side by side; a narrow one folds the same order into a stack.
 */
function composeHero(): Hero {
  const artWidth = Math.max(...ART.map((row) => [...row].length));
  const wordWidth = Math.max(...WORDMARK.map((row) => [...row].length));
  const lockupWidth = artWidth + HERO_GAP + wordWidth;
  const columns = terminalColumns();

  if (columns >= lockupWidth + PAD * 2) {
    const nameOffset = Math.floor((ART.length - WORDMARK.length) / 2);
    const rows = ART.map((artRow, index) => {
      const wordRow = WORDMARK[index - nameOffset];
      const name = wordRow ? padRow(wordRow, wordWidth) : " ".repeat(wordWidth);
      return `${artRow}${" ".repeat(HERO_GAP)}${name}`;
    });
    return { rows, width: lockupWidth, headerWidth: Math.max(W, lockupWidth) };
  }

  const width = Math.max(artWidth, wordWidth);
  const rows = [
    ...ART.map((row) => padRow(row, width)),
    "",
    ...WORDMARK.map((row) => padRow(row, wordWidth)),
  ];
  return { rows, width, headerWidth: W };
}

interface PaintedCell {
  char: string;
  /** colour for this cell, empty when the cell stays unpainted */
  color: string;
}

/** Colours the lockup once, so the reveal never shifts the gradient. */
function paintHero(rows: string[]): PaintedCell[][] {
  const last = Math.max(1, rows.length - 1);
  return rows.map((row, index) => {
    const tint = rgbFg(sample(index / last));
    return [...row].map((char) => ({ char, color: char === " " ? "" : tint }));
  });
}

/** Renders one row up to `limit` visible columns, switching colour only when it changes. */
function renderLine(line: PaintedCell[], limit: number): string {
  let text = "";
  let active = "";
  const stop = Math.min(limit, line.length);

  for (let index = 0; index < stop; index += 1) {
    const cell = line[index];
    if (cell.color !== active) {
      text += cell.color || RESET;
      active = cell.color;
    }
    text += cell.char;
  }
  return active ? text + RESET : text;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const HERO_FRAMES = 24;
const HERO_FRAME_MS = 22;

/** Reveals the lockup left to right and leaves the cursor under it. */
async function animateHero(rows: PaintedCell[][]): Promise<void> {
  const width = Math.max(...rows.map((line) => line.length));

  for (let frame = 1; frame <= HERO_FRAMES; frame += 1) {
    const limit = Math.ceil((width * frame) / HERO_FRAMES);
    if (frame > 1) raw(`\x1b[${rows.length}F`);
    for (const line of rows) {
      raw(`${renderLine(line, limit)}\x1b[K\n`);
    }
    if (frame < HERO_FRAMES) await sleep(HERO_FRAME_MS);
  }
}


const out = console.log.bind(console);
const raw = (s: string) => process.stdout.write(s);

const fmtBytes = (n: number): string =>
  n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`;

const fmtSec = (ms: number): string => `${(ms / 1000).toFixed(2)}s`;

function step(label: string, detail: string, color: string = C.cyan): void {
  out(`  ${color}●${RESET} ${C.mute}${label.padEnd(9)}${RESET} ${C.text}${detail}${RESET}`);
}

function live(label: string, detail: string): { stop: () => void } {
  const started = Date.now();
  const draw = () =>
    raw(
      `\r  ${C.yellow}◌${RESET} ${C.mute}${label.padEnd(9)}${RESET} ${C.text}${detail}${RESET} ${C.faint}${fmtSec(
        Date.now() - started,
      )}${RESET}\x1b[K`,
    );
  draw();
  const timer = setInterval(draw, 100);
  return {
    stop: () => {
      clearInterval(timer);
      raw("\r\x1b[K");
    },
  };
}

function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  for (const para of text.replace(/\r\n/g, "\n").split("\n")) {
    if (!para.trim()) {
      lines.push("");
      continue;
    }
    let cur = "";
    for (const word of para.split(/\s+/)) {
      if (!cur) cur = word;
      else if ([...cur].length + 1 + [...word].length <= width) cur += ` ${word}`;
      else {
        lines.push(cur);
        cur = word;
      }
    }
    if (cur) lines.push(cur);
  }
  while (lines.length > 0 && lines[0] === "") lines.shift();
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}


/**
 * Draws the console header. The mark and the wordmark are painted once and
 * then revealed left to right, so the animation never recolours the art.
 */
async function banner(active: ChatProvider, entry: ModelEntry): Promise<void> {
  console.clear();

  const hero = composeHero();
  const painted = paintHero(hero.rows);
  // Every text row below the mark is centred on the same width, so the header
  // reads as one block instead of several differently sized pieces.
  const heroRuleWidth = hero.headerWidth;

  out("");
  raw(`${C.faint}${"\x1b[?25l"}`); // hide the cursor while the art builds up
  await animateHero(painted);
  raw(`\x1b[?25h${RESET}`);

  out("");
  out(center(rule(heroRuleWidth), heroRuleWidth));
  const proxyMode = proxyLabel();
  out(
    center(
      `${C.faint}model${RESET} ${C.text}${entry.label}${RESET} ${C.faint}│${RESET} ${C.faint}provider${RESET} ${C.text}${entry.provider}${RESET} ${C.faint}│${RESET} ${C.faint}transport${RESET} ${C.text}https${RESET} ${C.faint}│${RESET} ${C.faint}proxy${RESET} ${C.text}${proxyMode}${RESET}`,
      heroRuleWidth,
    ),
  );
  out(center(rule(heroRuleWidth, 1, 0.4), heroRuleWidth));
  out("");
  out(
    center(
      `${C.faint}type${RESET} ${C.cyan}${UNDERLINE}/help${RESET}${C.faint} for commands${RESET} ${C.faint}·${RESET} ${C.faint}${UNDERLINE}/model${RESET}${C.faint} to switch${RESET} ${C.faint}·${RESET} ${C.faint}${ITALIC}plain text is a prompt${RESET}`,
      heroRuleWidth,
    ),
  );
  out("");
  out(
    center(
      `${C.faint}github.com/coders908${RESET} ${C.faint}·${RESET} ${C.violet}@Neriya${RESET}`,
      heroRuleWidth,
    ),
  );
  out("");
}

function printUser(text: string): void {
  out("");
  out(`  ${gradient("▎", 0, 0.4)} ${C.mute}${BOLD}you${RESET}`);
  for (const line of wrap(text, W - 6)) {
    out(`  ${C.text}${line}${RESET}`);
  }
}

class Answer {
  private readonly bodyW = W - 8;
  private col = 0;
  private chars = 0;

  start(): void {
    out("");
    out(`  ${gradient("▎", 0.3, 0.8)} ${C.mute}${BOLD}answer${RESET}`);
    raw(`  ${C.faint}│${RESET} ${C.text}`);
  }

  push(delta: string): void {
    for (const ch of delta) {
      if (ch === "\n") {
        raw(`${RESET}\n  ${C.faint}│${RESET} ${C.text}`);
        this.col = 0;
        continue;
      }
      raw(ch);
      this.col += 1;
      this.chars += 1;
      if (this.col >= this.bodyW) {
        raw(`${RESET}\n  ${C.faint}│${RESET} ${C.text}`);
        this.col = 0;
      }
    }
  }

  finish(): void {
    raw(`${RESET}\n`);
    out("");
  }

  abort(reason: string): void {
    raw(`${RESET}\n`);
    out(`  ${C.red}│${RESET} ${C.red}${reason}${RESET}`);
    out("");
  }
}

function errorBox(message: string): void {
  const inner = W - 4;
  const bodyW = inner - 2;
  const lines = wrap(message, bodyW);

  out("");
  out(`  ${gradient("╭─ error ", 1, 0.75)}${gradient("─".repeat(Math.max(2, inner - 7)), 0.75, 0.55)}`);
  for (const l of lines) {
    const len = [...l].length;
    out(
      `  ${C.red}│${RESET} ${C.text}${l}${RESET}${" ".repeat(Math.max(0, bodyW - len))} ${C.red}│${RESET}`,
    );
  }
  out(`  ${gradient("╰" + "─".repeat(inner), 0.55, 0.85)}`);
  out("");
}


const instances = new Map<string, ChatProvider>();

function entryFor(id: string): ModelEntry | undefined {
  return MODELS.find((m) => m.id === id);
}

function providerFor(entry: ModelEntry): ChatProvider {
  let provider = instances.get(entry.id);
  if (!provider) {
    provider = entry.create();
    instances.set(entry.id, provider);
  }
  return provider;
}

function isModelEvent(value: unknown): value is ChatEvent {
  return typeof value === "object" && value !== null && "type" in value;
}


async function ask(active: ChatProvider, text: string): Promise<void> {
  printUser(text);

  const started = Date.now();
  const state = {
    answer: null as Answer | null,
    live: null as { stop: () => void } | null,
    liveStep: null as { label: string; detail: string } | null,
    pendingProxyLines: [] as string[],
    firstByte: 0,
    done: null as Extract<ChatEvent, { type: "done" }> | null,
  };

  const stopLive = () => {
    state.live?.stop();
    state.live = null;
  };

  const flushProxyLines = () => {
    if (state.pendingProxyLines.length === 0) return;
    for (const line of state.pendingProxyLines) {
      step("proxy", line, C.violet);
    }
    state.pendingProxyLines.length = 0;
  };

  const beginLive = (label: string, detail: string) => {
    state.liveStep = { label, detail };
    state.live = live(label, detail);
  };

  setProxyReporter((usage: ProxyUsage) => {
    const line = `${usage.exit}  ${C.faint}·${RESET} ${C.text}${usage.request}`;
    if (state.answer) {
      state.pendingProxyLines.push(line);
      return;
    }
    stopLive();
    step("proxy", line, C.violet);
    if (state.liveStep) {
      state.live = live(state.liveStep.label, state.liveStep.detail);
    }
  });

  const colorFor = (label: string) =>
    label === "response"
      ? C.green
      : label === "proof" || label === "sdk"
        ? C.violet
        : C.cyan;

  try {
    const res = await active.send(text, {
      onDelta: (delta) => {
        if (!state.answer) {
          stopLive();
          flushProxyLines();
          state.answer = new Answer();
          state.answer.start();
        }
        state.answer.push(delta);
      },
      onEvent: (event) => {
        if (!isModelEvent(event)) return;
        switch (event.type) {
          case "pending":
            stopLive();
            beginLive(event.label, event.detail);
            break;
          case "stage":
            stopLive();
            state.liveStep = null;
            step(event.label, event.detail, colorFor(event.label));
            break;
          case "first-byte":
            state.firstByte = event.ms;
            break;
          case "done":
            state.done = event;
            break;
        }
      },
    });

    stopLive();
    state.liveStep = null;

    if (!state.answer) {
      state.answer = new Answer();
      state.answer.start();
      state.answer.push(res.text);
    }
    state.answer.finish();
    flushProxyLines();

    const total = state.done?.ms ?? Date.now() - started;
    const parts = [
      `${state.done?.chunks ?? res.chunks} chunk${(state.done?.chunks ?? res.chunks) === 1 ? "" : "s"}`,
      fmtBytes(state.done?.bytes ?? res.bytes),
      `${fmtSec(total)} total`,
    ];
    if (state.firstByte) parts.push(`first byte ${fmtSec(state.firstByte)}`);
    parts.push(`${res.text.length} chars`);
    if (state.done?.note) parts.push(state.done.note);

    out(`  ${C.faint}↳ ${parts.join(" · ")}${RESET}`);
    out("");
  } catch (err) {
    stopLive();
    const msg = describeError(err);

    if (state.answer) {
      state.answer.abort(msg);
      flushProxyLines();
    } else if (/fetch failed|TimeoutError|ECONNRESET|ETIMEDOUT|aborted/i.test(msg)) {
      flushProxyLines();
      errorBox(
        `Could not reach ${active.provider} — ${msg}\nProxy mode: ${proxyLabel()} · check the network or proxy.txt, then retry.`,
      );
    } else {
      flushProxyLines();
      errorBox(msg);
    }
  } finally {
    setProxyReporter(null);
  }
}


function showHelp(): void {
  const rows: Array<[string, string]> = [
    ["/model", "list providers and switch model"],
    ["/new", "drop the conversation context"],
    ["/history", "print the current conversation"],
    ["/system <text>", "set a system prompt (gemini only)"],
    ["/info", "endpoint, transport, proxy routing"],
    ["/clear", "redraw the console"],
    ["/exit", "close the session"],
  ];

  out("");
  out(`  ${C.mute}${BOLD}commands${RESET}`);
  out(`  ${rule(52, 0.1, 0.5)}`);
  for (const [cmd, desc] of rows) {
    out(
      `  ${C.cyan}${cmd.padEnd(16)}${RESET}${C.faint}${"·".repeat(2)}${RESET} ${C.text}${desc}${RESET}`,
    );
  }
  out("");
}

function showModels(entry: ModelEntry): void {
  out("");
  out(`  ${C.mute}${BOLD}models${RESET}`);
  out(`  ${rule(52, 0.5, 0.15)}`);
  MODELS.forEach((m, i) => {
    const isActive = m.id === entry.id;
    const mark = isActive ? `${C.green}▸${RESET}` : " ";
    const name = isActive ? `${C.text}${BOLD}${m.label}${RESET}` : `${C.mute}${m.label}${RESET}`;
    const tag = isActive ? `${C.green}active${RESET}` : `${C.faint}idle${RESET}`;
    out(
      `  ${mark} ${C.faint}${String(i + 1).padEnd(2)}${RESET} ${name.padEnd(Math.max(2, 30 - m.label.length))} ${C.faint}${m.provider.padEnd(8)}${RESET} ${tag}`,
    );
  });
  out(`  ${rule(52, 0.15, 0.5)}`);
  out(`  ${C.faint}switch with${RESET} ${C.cyan}/model gpt${RESET} ${C.faint}or${RESET} ${C.cyan}/model 2${RESET}`);
  out("");
}

function showHistory(active: ChatProvider): void {
  const messages = active.history();
  out("");
  out(`  ${C.mute}${BOLD}conversation${RESET} ${C.faint}${messages.length} messages${RESET}`);
  out(`  ${rule(52, 0.5, 0.1)}`);

  if (messages.length === 0) {
    out(`  ${C.faint}${ITALIC}empty${RESET}`);
    out("");
    return;
  }

  for (const message of messages) {
    const color = message.role === "user" ? C.cyan : C.violet;
    out(`  ${color}${message.role}${RESET}`);
    for (const line of wrap(message.content, W - 6).slice(0, 4)) {
      out(`  ${C.mute}${line}${RESET}`);
    }
    out("");
  }
}

function showInfo(active: ChatProvider): void {
  out("");
  for (const [label, value] of active.info()) {
    out(`  ${C.faint}${label.padEnd(12)}${RESET}${C.text}${value}${RESET}`);
  }
  out("");
}


let entry: ModelEntry = entryFor(DEFAULT_MODEL) ?? MODELS[0];
let active: ChatProvider = providerFor(entry);

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

const promptFor = (e: ModelEntry) =>
  `${gradient("▎", 0.2, 0.6)} ${C.red}${BOLD}rever${RESET} ${C.faint}·${RESET} ${C.violet}${e.short}${RESET} ${C.faint}▸${RESET} `;

rl.setPrompt(promptFor(entry));

/** The header animates first; the prompt only appears once it has settled. */
async function startSession(): Promise<void> {
  await banner(active, entry);
  // stdin can end mid-animation (piped input, `echo ... | npm run dev`).
  if (closing) {
    finishSession();
    return;
  }
  rl.prompt();
}

void startSession();

let busy = false;
let closing = false;

function finishSession(): void {
  out(`  ${C.faint}session closed${RESET}`);
  out("");
  process.exit(0);
}

async function handle(input: string): Promise<void> {
  const line = input.trim();
  if (!line) {
    rl.prompt();
    return;
  }

  const [head, ...rest] = line.split(/\s+/);
  const arg = rest.join(" ").trim();
  const command = head.toLowerCase();

  busy = true;
  rl.pause();

  switch (command) {
    case "/help":
    case "help":
      showHelp();
      break;
    case "/model":
    case "/models": {
      if (!arg) {
        showModels(entry);
        break;
      }
      const index = Number(arg);
      const target =
        (Number.isInteger(index) ? MODELS[index - 1] : undefined) ??
        MODELS.find((m) => m.id === arg.toLowerCase() || m.short === arg.toLowerCase());

      if (!target) {
        out("");
        out(`  ${C.red}●${RESET} ${C.mute}unknown model${RESET} ${C.text}${arg}${RESET}`);
        out("");
        break;
      }

      entry = target;
      active = providerFor(target);
      rl.setPrompt(promptFor(entry));
      await banner(active, entry);
      rl.prompt();
      busy = false;
      return;
    }
    case "/new":
      active.reset();
      out("");
      out(`  ${C.green}●${RESET} ${C.mute}context cleared${RESET}`);
      out("");
      break;
    case "/history":
      showHistory(active);
      break;
    case "/system":
      if (!active.supportsSystem) {
        out("");
        out(`  ${C.yellow}●${RESET} ${C.mute}${entry.label} ignores system prompts${RESET}`);
        out("");
        break;
      }
      active.setSystem?.(arg || undefined);
      out("");
      out(
        `  ${C.green}●${RESET} ${C.mute}${arg ? `system prompt set (${arg.length} chars)` : "system prompt cleared"}${RESET}`,
      );
      out("");
      break;
    case "/info":
      showInfo(active);
      break;
    case "/clear":
      await banner(active, entry);
      break;
    case "/exit":
    case "/quit":
      rl.close();
      return;
    default:
      await ask(active, line);
      break;
  }

  busy = false;
  if (closing) {
    finishSession();
    return;
  }
  rl.resume();
  rl.prompt();
}

rl.on("line", (input) => {
  if (busy) return;
  void handle(input);
});

rl.on("close", () => {
  closing = true;
  if (!busy) finishSession();
});
