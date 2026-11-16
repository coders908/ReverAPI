import fs from "node:fs";
import path from "node:path";
import { HttpsProxyAgent } from "https-proxy-agent";
import { ProxyAgent, fetch as undiciFetch, type Dispatcher } from "undici";


const PROXY_FILE = process.env.REVER_PROXY_FILE
  ? path.resolve(process.env.REVER_PROXY_FILE)
  : path.join(process.cwd(), "proxy.txt");

const MAX_PROXY_ATTEMPTS = 5;

export interface ProxyEndpoint {
  url: string;
  label: string;
  httpsAgent: HttpsProxyAgent<string>;
  dispatcher: Dispatcher;
}

let proxyPool: ProxyEndpoint[] | null = null;
let nextProxyIndex = 0;
let missingFileWarned = false;

export interface ProxyUsage {
  exit: string;
  request: string;
}

export const DIRECT_EXIT = "direct";

type ProxyReporter = (usage: ProxyUsage) => void;
let reporter: ProxyReporter | null = null;

const usageStats = {
  requests: 0,
  proxied: 0,
  direct: 0,
  lastExit: null as string | null,
};

export function setProxyReporter(next: ProxyReporter | null): void {
  reporter = next;
}

function reportUsage(exitLabel: string, request: string): void {
  usageStats.requests += 1;
  usageStats.lastExit = exitLabel;
  if (exitLabel === DIRECT_EXIT) usageStats.direct += 1;
  else usageStats.proxied += 1;

  if (!reporter) return;
  try {
    reporter({ exit: exitLabel, request });
  } catch {
  }
}

export function proxyUsage(): string {
  if (usageStats.requests === 0) return "no requests yet";
  const parts = [`${usageStats.requests} request${usageStats.requests === 1 ? "" : "s"}`];
  if (usageStats.proxied > 0) parts.push(`${usageStats.proxied} proxied`);
  if (usageStats.direct > 0) parts.push(`${usageStats.direct} direct`);
  if (usageStats.lastExit) parts.push(`last ${usageStats.lastExit}`);
  return parts.join(" · ");
}

export function isProxyEnabled(): boolean {
  const flag = (process.env.REVER_PROXY ?? "").toLowerCase();
  if (flag === "0" || flag === "off" || flag === "false") return false;
  if (flag === "1" || flag === "on" || flag === "true") return true;
  return process.env.npm_lifecycle_event === "dev";
}

function parseProxyLine(rawLine: string): ProxyEndpoint | null {
  const line = rawLine.trim();
  if (!line || line.startsWith("#") || line.startsWith("//")) return null;

  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(line) ? line : `http://${line}`;

  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    return null;
  }
  if (!parsed.hostname || !parsed.port) return null;

  const username = decodeURIComponent(parsed.username);
  const password = decodeURIComponent(parsed.password);
  const auth = username
    ? `${encodeURIComponent(username)}:${encodeURIComponent(password)}@`
    : "";
  const origin = `${parsed.protocol}//${parsed.host}`;
  const url = `${parsed.protocol}//${auth}${parsed.host}`;

  const dispatcherOptions: { uri: string; token?: string } = { uri: origin };
  if (username) {
    dispatcherOptions.token = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
  }

  return {
    url,
    label: parsed.host,
    httpsAgent: new HttpsProxyAgent(url),
    dispatcher: new ProxyAgent(dispatcherOptions),
  };
}

export function loadProxyPool(): ProxyEndpoint[] {
  if (proxyPool) return proxyPool;

  let lines: string[] = [];
  try {
    lines = fs.readFileSync(PROXY_FILE, "utf8").split(/\r?\n/);
  } catch {
    if (!missingFileWarned && isProxyEnabled()) {
      missingFileWarned = true;
      process.stderr.write(`  proxy       ${PROXY_FILE} not found · using direct connection\n`);
    }
    proxyPool = [];
    return proxyPool;
  }

  const seen = new Set<string>();
  const endpoints: ProxyEndpoint[] = [];
  for (const line of lines) {
    const endpoint = parseProxyLine(line);
    if (!endpoint || seen.has(endpoint.url)) continue;
    seen.add(endpoint.url);
    endpoints.push(endpoint);
  }

  proxyPool = endpoints;
  return proxyPool;
}

export function hasProxyPool(): boolean {
  return isProxyEnabled() && loadProxyPool().length > 0;
}

export function proxyLabel(): string {
  if (!isProxyEnabled()) return "off";
  const size = loadProxyPool().length;
  return size > 0 ? `on · ${size}` : "on · none";
}

export function proxyDetail(): string {
  if (!isProxyEnabled()) return "off · direct connection";
  const size = loadProxyPool().length;
  return size > 0
    ? `on · ${size} proxies · round-robin`
    : "on · no proxy.txt · direct connection";
}

export function nextProxy(): ProxyEndpoint | null {
  if (!hasProxyPool()) return null;
  const pool = loadProxyPool();
  const endpoint = pool[nextProxyIndex % pool.length];
  nextProxyIndex = (nextProxyIndex + 1) % pool.length;
  return endpoint;
}

export function takeProxyAgent(request: string): HttpsProxyAgent<string> | undefined {
  const endpoint = nextProxy();
  if (!endpoint) {
    reportUsage(DIRECT_EXIT, request);
    return undefined;
  }
  reportUsage(endpoint.label, request);
  return endpoint.httpsAgent;
}

export function proxyAttempts(): number {
  if (!hasProxyPool()) return 1;
  return Math.min(loadProxyPool().length, MAX_PROXY_ATTEMPTS);
}

export async function proxiedFetch(
  input: string | URL,
  init: RequestInit = {},
  target = "",
): Promise<Response> {
  const descriptor = target || describeRequest(input, init);

  if (!hasProxyPool()) {
    reportUsage(DIRECT_EXIT, descriptor);
    return fetch(input, init);
  }

  const attempts = proxyAttempts();
  let lastError: unknown = null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const endpoint = nextProxy();
    if (!endpoint) break;
    reportUsage(endpoint.label, descriptor);
    try {
      const response = await undiciFetch(input as string | URL, {
        ...(init as Record<string, unknown>),
        dispatcher: endpoint.dispatcher,
      });
      if (attempt < attempts - 1 && isRetryableStatus(response.status)) {
        await response.body?.cancel().catch(() => {});
        continue;
      }
      return response as unknown as Response;
    } catch (error) {
      lastError = error;
      if (attempt === attempts - 1 || !isRetryableNetworkError(error)) break;
    }
  }

  throw lastError ?? new Error("proxy pool exhausted");
}

function describeRequest(input: string | URL, init: RequestInit): string {
  const method = (init.method ?? "GET").toUpperCase();
  try {
    const url = new URL(String(input));
    return `${method} ${url.host}${url.pathname}`;
  } catch {
    return `${method} ${String(input)}`;
  }
}

function isRetryableStatus(status: number): boolean {
  return status === 407 || status === 429 || status >= 500;
}

const RETRYABLE_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ECONNABORTED",
  "ETIMEDOUT",
  "EPIPE",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EAI_AGAIN",
  "ERR_SOCKET_CLOSED",
]);

const PROXY_MESSAGES = /socket hang up|proxy|tunnel|connect ETIMEDOUT|network|fetch failed/i;

export function isRetryableNetworkError(error: unknown): boolean {
  let current: any = error;

  for (let depth = 0; current && depth < 5; depth += 1) {
    const code = typeof current.code === "string" ? current.code : "";
    if (code && RETRYABLE_CODES.has(code)) return true;
    const message = typeof current.message === "string" ? current.message : "";
    if (PROXY_MESSAGES.test(message)) return true;
    current = current.cause;
  }

  return false;
}

export function describeError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause: any = (error as { cause?: unknown }).cause;
  if (!cause) return error.message;
  const causeText =
    typeof cause === "object" && cause !== null
      ? `${(cause as any).message ?? ""}${(cause as any).code ? ` (${(cause as any).code})` : ""}`.trim()
      : String(cause);
  return causeText ? `${error.message} · ${causeText}` : error.message;
}
