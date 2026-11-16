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

const isBlankChar = (ch: string) => ch === "⠀" || ch === " ";

const isBlankRow = (line: string) => [...line].every(isBlankChar);

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


const BLOCK_GLYPHS: Record<string, string[]> = {
  R: ["████ ", "█   █", "████ ", "█  █ ", "█   █"],
  E: ["█████", "█    ", "████ ", "█    ", "█████"],
  V: ["█   █", "█   █", "█   █", " █ █ ", "  █  "],
  A: [" ███ ", "█   █", "█████", "█   █", "█   █"],
  P: ["████ ", "█   █", "████ ", "█    ", "█    "],
  I: ["█████", "  █  ", "  █  ", "  █  ", "█████"],
};

const BLOCK_ROWS = 5;

function buildWordmark(word: string): string[] {
  const rows: string[] = [];
  for (let row = 0; row < BLOCK_ROWS; row += 1) {
    rows.push([...word].map((letter) => BLOCK_GLYPHS[letter]?.[row] ?? "     ").join(" "));
  }
  return rows;
}

const WORDMARK = buildWordmark("REVERAPI");

const PAD = 2;

const MAX_CONTENT = 74;

const ANSI = /\x1b\[[0-9;]*m/g;

const visibleLength = (text: string): number => [...text.replace(ANSI, "")].length;

const stripAnsi = (text: string): string => text.replace(ANSI, "");

function terminalColumns(): number {
  const reported = process.stdout.columns ?? Number(process.env.COLUMNS);
  return Number.isFinite(reported) && reported > 0 ? Math.floor(reported) : 80;
}

function terminalRows(): number {
  const reported = process.stdout.rows ?? Number(process.env.LINES);
  return Number.isFinite(reported) && reported > 0 ? Math.floor(reported) : 24;
}

function contentWidth(): number {
  const available = terminalColumns() - PAD * 2;
  return Math.max(1, Math.min(MAX_CONTENT, available));
}

function center(text: string, width = contentWidth()): string {
  const fitted =
    visibleLength(text) > width ? truncate(stripAnsi(text), Math.max(1, width)) : text;
  const insideBlock = Math.max(0, Math.floor((width - visibleLength(fitted)) / 2));
  return " ".repeat(gutterFor(width) + insideBlock) + fitted;
}

function gutterFor(width: number): number {
  return Math.max(0, Math.floor((terminalColumns() - width) / 2));
}

const bodyIndent = (): string => " ".repeat(gutterFor(contentWidth()));

const rule = (width = contentWidth(), t0 = 0, t1 = 1) =>
  gradient("─".repeat(Math.max(1, width)), t0, t1);


const HERO_GAP = 4;

interface Hero {
  rows: string[];
  width: number;
  lead: number;
  headerWidth: number;
}

const padRow = (row: string, width: number): string => {
  const missing = width - [...row].length;
  return missing > 0 ? row + " ".repeat(missing) : row;
};

const PROMPT_ROOM = 8;

const LOCKUP_HEIGHT = ART.length;
const STACKED_HEIGHT = ART.length + 1 + BLOCK_ROWS;
const BLOCK_HEIGHT = BLOCK_ROWS;

function composeHero(): Hero {
  const columns = terminalColumns();
  const rows = terminalRows();
  const headerWidth = contentWidth();
  const artWidth = Math.max(...ART.map((row) => [...row].length));
  const wordWidth = Math.max(...WORDMARK.map((row) => [...row].length));
  const lockupWidth = artWidth + HERO_GAP + wordWidth;
  const room = columns - PAD * 2;
  const fitsHeight = (height: number) => rows >= height + PROMPT_ROOM;

  if (fitsHeight(LOCKUP_HEIGHT) && room >= lockupWidth) {
    const nameOffset = Math.floor((ART.length - WORDMARK.length) / 2);
    const lockup = ART.map((artRow, index) => {
      const wordRow = WORDMARK[index - nameOffset];
      const name = wordRow ? padRow(wordRow, wordWidth) : " ".repeat(wordWidth);
      return `${artRow}${" ".repeat(HERO_GAP)}${name}`;
    });
    return { rows: lockup, width: lockupWidth, lead: gutterFor(lockupWidth), headerWidth };
  }

  if (fitsHeight(STACKED_HEIGHT) && room >= Math.max(artWidth, wordWidth)) {
    const width = Math.max(artWidth, wordWidth);
    const stacked = [
      ...ART.map((row) => padRow(row, width)),
      "",
      ...WORDMARK.map((row) => padRow(row, wordWidth)),
    ];
    return { rows: stacked, width, lead: gutterFor(width), headerWidth };
  }

  const wordRows = blockName(room, fitsHeight(BLOCK_HEIGHT));
  const width = Math.max(...wordRows.map((row) => [...row].length));
  return { rows: wordRows, width, lead: gutterFor(width), headerWidth };
}

function blockName(room: number, blocksFit: boolean): string[] {
  const fullWidth = [...WORDMARK[0]].length;
  const shortWidth = [...buildWordmark("REVER")[0]].length;

  if (blocksFit && room >= fullWidth) return WORDMARK;
  if (blocksFit && room >= shortWidth) return buildWordmark("REVER");

  const name = room >= fullWidth ? "REVERAPI" : "REVER";
  return [name];
}

interface PaintedCell {
  char: string;
  color: string;
}

function paintHero(rows: string[]): PaintedCell[][] {
  const last = Math.max(1, rows.length - 1);
  return rows.map((row, index) => {
    const tint = rgbFg(sample(index / last));
    return [...row].map((char) => ({ char, color: char === " " ? "" : tint }));
  });
}

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

async function animateHero(rows: PaintedCell[][], lead = 0): Promise<void> {
  const width = Math.max(...rows.map((line) => line.length));
  const indent = " ".repeat(Math.max(0, lead));

  for (let frame = 1; frame <= HERO_FRAMES; frame += 1) {
    const limit = Math.ceil((width * frame) / HERO_FRAMES);
    if (frame > 1) raw(`\x1b[${rows.length}F`);
    for (const line of rows) {
      raw(`${indent}${renderLine(line, limit)}\x1b[K\n`);
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
  out(`${bodyIndent()}${color}●${RESET} ${C.mute}${label.padEnd(9)}${RESET} ${C.text}${detail}${RESET}`);
}

function live(label: string, detail: string): { stop: () => void } {
  const started = Date.now();
  const draw = () =>
    raw(
      `\r${bodyIndent()}${C.yellow}◌${RESET} ${C.mute}${label.padEnd(9)}${RESET} ${C.text}${detail}${RESET} ${C.faint}${fmtSec(
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
  const limit = Math.max(4, width);
  const lines: string[] = [];

  for (const para of text.replace(/\r\n/g, "\n").split("\n")) {
    if (!para.trim()) {
      lines.push("");
      continue;
    }

    let current = "";
    for (const word of para.split(/\s+/)) {
      const fitsOnLine = [...current].length + (current ? 1 : 0) + [...word].length <= limit;
      if (current && fitsOnLine) {
        current += ` ${word}`;
        continue;
      }
      if (current) lines.push(current);

      if ([...word].length <= limit) {
        current = word;
        continue;
      }
      const letters = [...word];
      for (let index = 0; index < letters.length; index += limit) {
        const chunk = letters.slice(index, index + limit).join("");
        const isLastChunk = index + limit >= letters.length;
        if (isLastChunk) current = chunk;
        else lines.push(chunk);
      }
    }
    if (current) lines.push(current);
  }

  while (lines.length > 0 && lines[0] === "") lines.shift();
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}


function fitLine(segments: string[], maxWidth: number): string {
  const separator = ` ${C.faint}│${RESET} `;
  const kept = [...segments];

  const join = (parts: string[]) => parts.join(separator);
  while (kept.length > 1 && visibleLength(join(kept)) > maxWidth) {
    kept.pop();
  }

  const line = join(kept);
  if (visibleLength(line) <= maxWidth) return line;
  return truncate(stripAnsi(line), maxWidth);
}

async function banner(active: ChatProvider, entry: ModelEntry): Promise<void> {
  console.clear();

  const hero = composeHero();
  const painted = paintHero(hero.rows);
  const heroRuleWidth = hero.headerWidth;
  const usedRows = hero.rows.length + 5;
  const spare = terminalRows() - usedRows;

  out("");
  raw(`${C.faint}${"\x1b[?25l"}`);
  await animateHero(painted, hero.lead);
  raw(`\x1b[?25h${RESET}`);

  const hint =
    heroRuleWidth >= 68
      ? `${C.faint}type${RESET} ${C.cyan}${UNDERLINE}/help${RESET}${C.faint} for commands${RESET} ${C.faint}·${RESET} ${C.faint}${UNDERLINE}/model${RESET}${C.faint} to switch${RESET} ${C.faint}·${RESET} ${C.faint}${ITALIC}plain text is a prompt${RESET}`
      : heroRuleWidth >= 18
        ? `${C.cyan}${UNDERLINE}/help${RESET} ${C.faint}·${RESET} ${C.faint}${UNDERLINE}/model${RESET}`
        : `${C.cyan}${UNDERLINE}/help${RESET}`;

  out("");
  out(center(rule(heroRuleWidth), heroRuleWidth));
  out(
    center(
      fitLine(
        [
          `${C.faint}model${RESET} ${C.text}${entry.label}${RESET}`,
          `${C.faint}provider${RESET} ${C.text}${entry.provider}${RESET}`,
          `${C.faint}proxy${RESET} ${C.text}${proxyLabel()}${RESET}`,
          `${C.faint}transport${RESET} ${C.text}https${RESET}`,
        ],
        heroRuleWidth,
      ),
      heroRuleWidth,
    ),
  );
  out(center(rule(heroRuleWidth, 1, 0.4), heroRuleWidth));

  if (spare >= 4) {
    out("");
    out(center(hint, heroRuleWidth));
  }
  if (spare >= 6) {
    out("");
    out(
      center(
        heroRuleWidth >= 34
          ? `${C.faint}github.com/coders908${RESET} ${C.faint}·${RESET} ${C.violet}@Neriya${RESET}`
          : `${C.violet}@Neriya${RESET}`,
        heroRuleWidth,
      ),
    );
  }
  out("");
}

function printUser(text: string): void {
  out("");
  out(`${bodyIndent()}${gradient("▎", 0, 0.4)} ${C.mute}${BOLD}you${RESET}`);
  for (const line of wrap(text, contentWidth() - 4)) {
    out(`${bodyIndent()}  ${C.text}${line}${RESET}`);
  }
}

class Answer {
  private col = 0;
  private chars = 0;

  private get bodyW(): number {
    return Math.max(4, contentWidth() - 4);
  }

  private gutterLine(): string {
    return `${bodyIndent()}  ${C.faint}│${RESET} ${C.text}`;
  }

  start(): void {
    out("");
    out(`${bodyIndent()}${gradient("▎", 0.3, 0.8)} ${C.mute}${BOLD}answer${RESET}`);
    raw(this.gutterLine());
  }

  push(delta: string): void {
    for (const ch of delta) {
      if (ch === "\n") {
        raw(`${RESET}\n${this.gutterLine()}`);
        this.col = 0;
        continue;
      }
      raw(ch);
      this.col += 1;
      this.chars += 1;
      if (this.col >= this.bodyW) {
        raw(`${RESET}\n${this.gutterLine()}`);
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
    out(`${bodyIndent()}  ${C.red}│${RESET} ${C.red}${reason}${RESET}`);
    out("");
  }
}

function errorBox(message: string): void {
  const indent = `${bodyIndent()}  `;
  const boxWidth = Math.max(10, contentWidth() - 2);
  const bodyW = boxWidth - 4;
  const lines = wrap(message, bodyW);
  const head = "╭─ error ";

  out("");
  out(
    `${indent}${gradient(head, 1, 0.75)}${gradient("─".repeat(Math.max(0, boxWidth - head.length)), 0.75, 0.55)}`,
  );
  for (const l of lines) {
    const len = [...l].length;
    out(
      `${indent}${C.red}│${RESET} ${C.text}${l}${RESET}${" ".repeat(Math.max(0, bodyW - len))} ${C.red}│${RESET}`,
    );
  }
  out(`${indent}${gradient("╰" + "─".repeat(boxWidth - 1), 0.55, 0.85)}`);
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

    out(`${bodyIndent()}${C.faint}↳ ${parts.join(" · ")}${RESET}`);
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


const indentRule = (t0: number, t1: number) => rule(Math.max(8, contentWidth() - 2), t0, t1);

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
  out(`${bodyIndent()}${C.mute}${BOLD}commands${RESET}`);
  out(`${bodyIndent()}${indentRule(0.1, 0.5)}`);

  const width = contentWidth();
  const longestCommand = Math.max(...rows.map(([cmd]) => [...cmd].length));

  const sideBySide = width >= 34;
  const commandColumn = Math.min(longestCommand, Math.floor(width / 2));
  const descriptionGap = commandColumn + 4;
  const detailsIndent = " ".repeat(descriptionGap);

  for (const [cmd, desc] of rows) {
    if (sideBySide) {
      const [firstLine, ...rest] = wrap(desc, Math.max(8, width - descriptionGap));
      out(
        `${bodyIndent()}${C.cyan}${cmd.padEnd(commandColumn)}${RESET} ${C.faint}··${RESET} ${C.text}${firstLine ?? ""}${RESET}`,
      );
      for (const extra of rest) {
        out(`${bodyIndent()}${C.faint}${detailsIndent}${extra}${RESET}`);
      }
    } else {
      out(`${bodyIndent()}${C.cyan}${truncate(cmd, width)}${RESET}`);
      for (const line of wrap(desc, Math.max(4, width - 2))) {
        out(`${bodyIndent()}  ${C.faint}${line}${RESET}`);
      }
    }
  }
  out("");
}

function showModels(entry: ModelEntry): void {
  out("");
  out(`${bodyIndent()}${C.mute}${BOLD}models${RESET}`);
  out(`${bodyIndent()}${indentRule(0.5, 0.15)}`);

  const width = contentWidth();
  const showProvider = width >= 46;
  const showTag = width >= 22;
  const decorationWidth = 4 + (showProvider ? 9 : 0) + (showTag ? 7 : 0);
  const labelWidth = Math.max(4, width - decorationWidth);

  MODELS.forEach((m, i) => {
    const isActive = m.id === entry.id;
    const mark = isActive ? `${C.green}▸${RESET}` : " ";
    const label = truncate(m.label, labelWidth);
    const name = isActive
      ? `${C.text}${BOLD}${label}${RESET}`
      : `${C.mute}${label}${RESET}`;
    const tag = showTag
      ? ` ${isActive ? `${C.green}active${RESET}` : `${C.faint}idle${RESET}`}`
      : "";
    const provider = showProvider
      ? `${C.faint}${m.provider.padEnd(8)}${RESET} `
      : "";
    const pad = " ".repeat(Math.max(0, labelWidth - [...label].length));
    out(`${bodyIndent()}${mark} ${C.faint}${String(i + 1).padEnd(2)}${RESET} ${name}${pad} ${provider}${tag}`);
  });

  out(`${bodyIndent()}${indentRule(0.15, 0.5)}`);

  const examples = `${C.cyan}/model gpt${RESET}${C.faint} or ${RESET}${C.cyan}/model 2${RESET}`;
  const hinted =
    width >= 40
      ? `switch with ${examples}`
      : width >= 20
        ? examples
        : `${C.cyan}/model 2${RESET}`;
  out(`${bodyIndent()}${C.faint}${hinted}${RESET}`);
  out("");
}

function truncate(text: string, width: number): string {
  const characters = [...text];
  if (characters.length <= width) return text;
  if (width <= 1) return characters.slice(0, Math.max(1, width)).join("");
  return `${characters.slice(0, width - 1).join("")}…`;
}

function showHistory(active: ChatProvider): void {
  const messages = active.history();
  out("");
  const width = contentWidth();
  const count = `${C.faint}${messages.length} messages${RESET}`;
  const heading =
    visibleLength(count) + 13 <= width
      ? `${C.mute}${BOLD}conversation${RESET} ${count}`
      : `${C.mute}${BOLD}conversation${RESET}`;
  out(`${bodyIndent()}${width >= 13 ? heading : `${C.mute}${BOLD}history${RESET}`}`);
  out(`${bodyIndent()}${indentRule(0.5, 0.1)}`);

  if (messages.length === 0) {
    out(`${bodyIndent()}${C.faint}${ITALIC}empty${RESET}`);
    out("");
    return;
  }

  for (const message of messages) {
    const color = message.role === "user" ? C.cyan : C.violet;
    out(`${bodyIndent()}${color}${message.role}${RESET}`);
    for (const line of wrap(message.content, contentWidth() - 4).slice(0, 4)) {
      out(`${bodyIndent()}  ${C.mute}${line}${RESET}`);
    }
    out("");
  }
}

function showInfo(active: ChatProvider): void {
  out("");

  const width = contentWidth();
  const sideBySide = width >= 26;
  const labelWidth = sideBySide ? 12 : 0;
  const underIndent = sideBySide ? " ".repeat(labelWidth) : "  ";
  const valueWidth = Math.max(4, width - underIndent.length);

  for (const [label, value] of active.info()) {
    const [first, ...rest] = wrap(value, valueWidth);

    if (sideBySide) {
      out(`${bodyIndent()}${C.faint}${label.padEnd(labelWidth)}${RESET}${C.text}${first ?? ""}${RESET}`);
    } else {
      out(`${bodyIndent()}${C.faint}${label}${RESET}`);
      if (first) out(`${bodyIndent()}${underIndent}${C.text}${first}${RESET}`);
    }

    for (const extra of rest) {
      out(`${bodyIndent()}${underIndent}${C.text}${extra}${RESET}`);
    }
  }
  out("");
}


let entry: ModelEntry = entryFor(DEFAULT_MODEL) ?? MODELS[0];
let active: ChatProvider = providerFor(entry);

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

const promptFor = (e: ModelEntry) => {
  const columns = terminalColumns();
  const CHROME = "▎ rever ·  ▸ ".length;
  const roomFor = (gutter: number) => columns - gutter - CHROME;

  let indent = bodyIndent();
  if (roomFor(indent.length) < 8) indent = "";

  const name = truncate(e.short, Math.max(1, roomFor(indent.length)));

  return `${indent}${gradient("▎", 0.2, 0.6)} ${C.red}${BOLD}rever${RESET} ${C.faint}·${RESET} ${C.violet}${name}${RESET} ${C.faint}▸${RESET} `;
};

rl.setPrompt(promptFor(entry));

async function startSession(): Promise<void> {
  await banner(active, entry);
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
  out(`${bodyIndent()}${C.faint}session closed${RESET}`);
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
        out(`${bodyIndent()}${C.red}●${RESET} ${C.mute}unknown model${RESET} ${C.text}${arg}${RESET}`);
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
      out(`${bodyIndent()}${C.green}●${RESET} ${C.mute}context cleared${RESET}`);
      out("");
      break;
    case "/history":
      showHistory(active);
      break;
    case "/system":
      if (!active.supportsSystem) {
        out("");
        out(`${bodyIndent()}${C.yellow}●${RESET} ${C.mute}${entry.label} ignores system prompts${RESET}`);
        out("");
        break;
      }
      active.setSystem?.(arg || undefined);
      out("");
      out(
        `${bodyIndent()}${C.green}●${RESET} ${C.mute}${arg ? `system prompt set (${arg.length} chars)` : "system prompt cleared"}${RESET}`,
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
