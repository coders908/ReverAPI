import type {
  ChatMessage,
  ChatProvider,
  ChatResult,
  SendHandlers,
} from "../types.js";
import { proxiedFetch, proxyDetail, proxyUsage } from "../../src/proxy.js";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36";

const DEFAULT_BL = "boq_assistant-bard-web-server_20260821.03_p0";

const ENDPOINT =
  "https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate";

export interface GeminiResponse {
  text: string;
  raw: string;
  id: string;
  chunks: number;
  bytes: number;
}

export type GeminiEvent =
  | { type: "request"; messages: number; promptBytes: number; bl: string }
  | {
      type: "response";
      status: number;
      statusText: string;
      contentType: string;
      ms: number;
    }
  | { type: "first-byte"; ms: number }
  | { type: "done"; chunks: number; bytes: number; deltas: number; ms: number };

export interface GeminiHandlers {
  onDelta?: (delta: string) => void;
  onEvent?: (event: GeminiEvent) => void;
}


export function buildFullPrompt(messages: ChatMessage[]): string {
  let fullPrompt = "";

  for (const msg of messages) {
    const content = msg.content;

    if (msg.role === "system") {
      fullPrompt += `Instructions: ${content}\n\n`;
    } else if (msg.role === "user") {
      fullPrompt += `User: ${content}\n\n`;
    } else {
      fullPrompt += `Assistant: ${content}\n\n`;
    }
  }

  fullPrompt += "Assistant:";
  return fullPrompt;
}


const decodeEscapes = (value: string): string =>
  value.replace(/\\(u[0-9a-fA-F]{4}|n|t|r|"|\\|\/)/g, (_match, seq: string) => {
    if (seq.startsWith("u")) {
      return String.fromCharCode(parseInt(seq.slice(1), 16));
    }
    switch (seq) {
      case "n":
        return "\n";
      case "t":
        return "\t";
      case "r":
        return "\r";
      default:
        return seq;
    }
  });

const unescapeJsonString = (fragment: string): string | null => {
  try {
    const parsed = JSON.parse(`"${fragment}"`) as string;
    return parsed.includes("\\") ? decodeEscapes(parsed) : parsed;
  } catch {
    return null;
  }
};

const LEAKY_URL_HOSTS = [
  "googleusercontent.com",
  "gemini.google.com",
  "vertexaisearch.cloud.google.com",
];

const URL_SCHEME = /https?:\/\//i;
const URL_TERMINATOR = /[\s<>"'`)\]]/;

const escapeForRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function isLeakyHost(host: string): boolean {
  const lowercased = host.toLowerCase();
  return LEAKY_URL_HOSTS.some(
    (leakyHost) => lowercased === leakyHost || lowercased.endsWith(`.${leakyHost}`),
  );
}

const LEAKY_URL = new RegExp(
  `${URL_SCHEME.source}(?:[^\\s/()\\[\\]<>"'\`]*\\.)?(?:${LEAKY_URL_HOSTS.map(escapeForRegExp).join(
    "|",
  )})(?:[^\\s<>"'\`)\\]])*`,
  "gi",
);

const LINK_OPENER_TAIL = /\[[^[\]\n]{0,40}\]\($/;

const LINK_OPENER_MAYBE_TAIL = /\[[^[\]\n]{0,40}\]?\(?$/;

const EMPTY_MARKDOWN_LINK = /\[[^[\]\n]{0,40}\]\(\s*\)/g;

export function stripLeakyUrls(text: string): string {
  if (!text) return text;

  return text
    .replace(LEAKY_URL, "")
    .replace(EMPTY_MARKDOWN_LINK, "")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd();
}

function partialSchemeLength(text: string): number {
  const longestProbe = Math.min(text.length, "https://".length - 1);

  for (let length = longestProbe; length > 0; length -= 1) {
    const tail = text.slice(text.length - length).toLowerCase();
    if ("https://".startsWith(tail) || "http://".startsWith(tail)) return length;
  }
  return 0;
}

function splitUnsafeTail(text: string): { kept: string; held: string } {
  const afterScheme = text.slice(0, text.length - partialSchemeLength(text));
  const opener = LINK_OPENER_MAYBE_TAIL.exec(afterScheme);
  const cut = opener ? opener.index : afterScheme.length;

  return { kept: text.slice(0, cut), held: text.slice(cut) };
}

function splitSafeText(buffer: string): {
  ready: string;
  pending: string;
  dropped: boolean;
} {
  let ready = "";
  let cursor = 0;
  let dropped = false;

  while (cursor < buffer.length) {
    const rest = buffer.slice(cursor);
    const schemeAt = rest.search(URL_SCHEME);

    if (schemeAt === -1) {
      const { kept, held } = splitUnsafeTail(rest);
      return { ready: ready + kept, pending: held, dropped };
    }

    const urlStart = cursor + schemeAt;
    ready += buffer.slice(cursor, urlStart);

    const fromScheme = buffer.slice(urlStart);
    const schemeLength = URL_SCHEME.exec(fromScheme)![0].length;
    const afterScheme = fromScheme.slice(schemeLength);
    const terminatorAt = afterScheme.search(URL_TERMINATOR);

    if (terminatorAt === -1) {
      const host = afterScheme.split("/")[0];
      const hostIsSettled = afterScheme.includes("/") && host.includes(".");
      if (hostIsSettled && !isLeakyHost(host)) {
        return { ready: ready + fromScheme, pending: "", dropped };
      }
      const { kept, held } = splitUnsafeTail(ready);
      return { ready: kept, pending: held + fromScheme, dropped };
    }

    const urlEnd = urlStart + schemeLength + terminatorAt;
    const url = buffer.slice(urlStart, urlEnd);
    if (!isLeakyHost(url.slice(schemeLength).split("/")[0])) {
      ready += url;
      cursor = urlEnd;
      continue;
    }

    ready = ready.replace(LINK_OPENER_TAIL, "");
    cursor = buffer[urlEnd] === ")" ? urlEnd + 1 : urlEnd;
    dropped = true;
    while (buffer[cursor] === " ") cursor += 1;
  }

  const { kept, held } = splitUnsafeTail(ready);
  return { ready: kept, pending: held, dropped };
}

export interface CitationFilter {
  push(delta: string): string;
  finish(): string;
}

export function createCitationFilter(): CitationFilter {
  let pending = "";
  let lastChar = "";
  let needsSpaceCollapse = false;

  const collapseGap = (text: string): string => {
    if (!needsSpaceCollapse) return text;

    const leadingBlanks = /^[ \t\n]*/.exec(text)![0];
    if (leadingBlanks.includes("\n")) {
      needsSpaceCollapse = false;
      return text;
    }
    if (leadingBlanks.length === text.length) return "";

    needsSpaceCollapse = false;
    if (leadingBlanks.length === 0) return text;
    const afterSpaces = text.slice(leadingBlanks.length);
    return (lastChar === " " || lastChar === "" ? "" : " ") + afterSpaces;
  };

  return {
    push(delta: string): string {
      const { ready, pending: rest, dropped } = splitSafeText(pending + delta);
      pending = rest;

      if (dropped) needsSpaceCollapse = true;
      const visible = collapseGap(ready);
      if (visible.length > 0) lastChar = visible[visible.length - 1];
      return visible;
    },
    finish(): string {
      const remaining = pending;
      pending = "";
      if (!remaining) return "";

      const kept = (() => {
        if (URL_SCHEME.test(remaining)) {
          const afterOpener = remaining.replace(/^\[[^[\]\n]{0,40}\]\(/, "");
          const host = afterOpener.replace(URL_SCHEME, "").split("/")[0];
          return isLeakyHost(host) ? "" : remaining;
        }
        return LINK_OPENER_TAIL.test(remaining) ? "" : remaining;
      })();

      if (kept === "") return "";
      needsSpaceCollapse = false;
      return kept;
    },
  };
}

export function parseGeminiChunk(chunkText: string): string | null {
  const primary = [
    ...chunkText.matchAll(/\[\[\\"rc_[^"]+\\",\[\\"([\s\S]*?)\\"\]/g),
  ];
  if (primary.length > 0) {
    const last = unescapeJsonString(primary[primary.length - 1][1]);
    if (last !== null) return last;
  }

  const fallback = [
    ...chunkText.matchAll(/\[\[\[null,\[null,0,\\"([\s\S]*?)\\"\]\]\]\]/g),
  ];
  if (fallback.length > 0) {
    const last = unescapeJsonString(fallback[fallback.length - 1][1]);
    if (last !== null) return last;
  }

  return parseWrbFr(chunkText);
}

function parseWrbFr(chunkText: string): string | null {
  let text: string | null = null;

  for (const line of chunkText.split("\n")) {
    const trimmed = line.trim();
    const idx = trimmed.indexOf("[");
    if (idx === -1) continue;

    let chunk: unknown;
    try {
      chunk = JSON.parse(trimmed.slice(idx));
    } catch {
      continue;
    }
    if (!Array.isArray(chunk)) continue;

    for (const entry of chunk) {
      if (!Array.isArray(entry) || entry[0] !== "wrb.fr") continue;
      const payload = entry[2];
      if (typeof payload !== "string") continue;

      let inner: unknown;
      try {
        inner = JSON.parse(payload);
      } catch {
        continue;
      }
      const candidate = (inner as any)?.[4]?.[0]?.[1]?.[0];
      if (typeof candidate === "string" && candidate.length > 0) text = candidate;
    }
  }

  return text;
}


export interface GeminiClientOptions {
  system?: string;
  bl?: string;
  timeoutMs?: number;
}

export class GeminiClient {
  private readonly bl: string;
  private readonly timeoutMs: number;
  private readonly history: ChatMessage[] = [];
  private system?: string;

  constructor(options: GeminiClientOptions = {}) {
    this.bl = options.bl ?? process.env.GEMINI_BL ?? DEFAULT_BL;
    this.system = options.system;
    this.timeoutMs = options.timeoutMs ?? 150_000;
  }

  get messages(): readonly ChatMessage[] {
    return this.history;
  }

  get buildId(): string {
    return this.bl;
  }

  setSystem(prompt: string | undefined): void {
    this.system = prompt;
  }

  reset(): void {
    this.history.length = 0;
  }

  async sendMessage(message: string, handlers: GeminiHandlers = {}): Promise<GeminiResponse> {
    const started = Date.now();
    const messages: ChatMessage[] = [
      ...(this.system ? [{ role: "system" as const, content: this.system }] : []),
      ...this.history,
      { role: "user" as const, content: message },
    ];

    const prompt = buildFullPrompt(messages);
    const url = `${ENDPOINT}?bl=${encodeURIComponent(this.bl)}&hl=en-US&rt=c`;

    const reqData = [
      null,
      JSON.stringify([[prompt, 0, null, null, null, null, 0], ["en-US"]]),
    ];

    const body = new URLSearchParams();
    body.append("f.req", JSON.stringify(reqData));
    const payload = body.toString();

    handlers.onEvent?.({
      type: "request",
      messages: messages.length,
      promptBytes: Buffer.byteLength(payload, "utf8"),
      bl: this.bl,
    });

    const res = await proxiedFetch(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
          "User-Agent": USER_AGENT,
          "X-Same-Domain": "1",
          Origin: "https://gemini.google.com",
          Referer: "https://gemini.google.com/",
          Accept: "*/*",
          "Accept-Language": "en-US,en;q=0.9",
        },
        body: payload,
        signal: AbortSignal.timeout(this.timeoutMs),
      },
      "POST /StreamGenerate",
    );

    handlers.onEvent?.({
      type: "response",
      status: res.status,
      statusText: res.statusText,
      contentType: res.headers.get("content-type") ?? "unknown",
      ms: Date.now() - started,
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(
        `Gemini request failed: ${res.status} ${res.statusText} ${detail.slice(0, 400)}`,
      );
    }
    if (!res.body) {
      throw new Error("Gemini returned an empty stream");
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    const citations = createCitationFilter();
    let raw = "";
    let previous = "";
    let text = "";
    let chunks = 0;
    let bytes = 0;
    let deltas = 0;
    let firstByteMs = 0;

    const emit = (delta: string) => {
      text += delta;
      handlers.onDelta?.(delta);
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      if (firstByteMs === 0 && value && value.byteLength > 0) {
        firstByteMs = Date.now() - started;
        handlers.onEvent?.({ type: "first-byte", ms: firstByteMs });
      }

      chunks += 1;
      bytes += value?.byteLength ?? 0;
      raw += decoder.decode(value, { stream: true });

      const current = parseGeminiChunk(raw);
      if (!current || current === previous) continue;

      const delta = current.slice(previous.length);
      previous = current;
      if (delta.length === 0) continue;

      deltas += 1;
      const visible = citations.push(delta);
      if (visible.length > 0) emit(visible);
    }

    const tail = citations.finish();
    if (tail.length > 0) emit(tail);

    handlers.onEvent?.({
      type: "done",
      chunks,
      bytes,
      deltas,
      ms: Date.now() - started,
    });

    if (text.trim().length === 0) {
      throw new Error("Gemini returned an empty response");
    }

    this.history.push({ role: "user", content: message });
    this.history.push({ role: "assistant", content: stripLeakyUrls(text) });

    return {
      text: stripLeakyUrls(text),
      raw,
      id: `chatcmpl-${Date.now()}`,
      chunks,
      bytes,
    };
  }
}

export function createGeminiClient(options: GeminiClientOptions = {}): GeminiClient {
  return new GeminiClient(options);
}


export class GeminiProvider implements ChatProvider {
  readonly id = "gemini";
  readonly model = "gemini 3.5 flash lite";
  readonly provider = "google";
  readonly supportsSystem = true;

  private client = new GeminiClient({ system: process.env.REVER_SYSTEM_PROMPT });

  async send(text: string, handlers: SendHandlers = {}): Promise<ChatResult> {
    const res = await this.client.sendMessage(text, {
      onDelta: handlers.onDelta,
      onEvent: (event) => {
        if (event.type === "request") {
          handlers.onEvent?.({
            type: "stage",
            label: "payload",
            detail: `${event.messages} message${event.messages === 1 ? "" : "s"} · ${fmtBytes(
              event.promptBytes,
            )}`,
          });
          handlers.onEvent?.({
            type: "pending",
            label: "request",
            detail: "POST /StreamGenerate",
          });
        } else if (event.type === "response") {
          handlers.onEvent?.({
            type: "stage",
            label: "response",
            detail: `${event.status} ${event.statusText} · ${event.contentType.split(";")[0]} · ${fmtSec(
              event.ms,
            )}`,
          });
        } else if (event.type === "first-byte") {
          handlers.onEvent?.({ type: "first-byte", ms: event.ms });
        } else {
          handlers.onEvent?.({
            type: "done",
            chunks: event.chunks,
            bytes: event.bytes,
            ms: event.ms,
          });
        }
      },
    });

    return { text: res.text, chunks: res.chunks, bytes: res.bytes };
  }

  reset(): void {
    this.client.reset();
  }

  history(): readonly ChatMessage[] {
    return this.client.messages;
  }

  setSystem(prompt: string | undefined): void {
    this.client.setSystem(prompt);
  }

  info(): Array<[string, string]> {
    const c = this.client;
    return [
      ["endpoint", "gemini.google.com · /StreamGenerate"],
      ["build", c.buildId],
      ["transport", "POST · https · cookie-free"],
      ["proxy", proxyDetail()],
      ["routing", proxyUsage()],
      ["model", "gemini 3.5 flash lite"],
      ["context", `${c.messages.length} messages`],
    ];
  }
}

const fmtBytes = (n: number): string =>
  n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`;

const fmtSec = (ms: number): string => `${(ms / 1000).toFixed(2)}s`;
