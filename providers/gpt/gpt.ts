import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import vm from "node:vm";
import crypto from "node:crypto";
import {
  isRetryableNetworkError,
  proxiedFetch,
  proxyAttempts,
  proxyDetail,
  proxyUsage,
  takeProxyAgent,
} from "../../src/proxy.js";
import type {
  ChatMessage,
  ChatProvider,
  ChatResult,
  SendHandlers,
} from "../types.js";

const BASE = "https://chatgpt.com";
const DATA_DIR = path.join(process.cwd(), "data");
const DUMP_PATH = path.join(DATA_DIR, "sentinel-sdk.dump.js");

let dumpActive = false;

function ensureDataDir(): void {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch {
  }
}

function writeDump(contents: string): void {
  if (!dumpActive) return;
  ensureDataDir();
  try {
    fs.writeFileSync(DUMP_PATH, contents);
  } catch {
  }
}

function appendDump(contents: string): void {
  if (!dumpActive) return;
  ensureDataDir();
  try {
    fs.appendFileSync(DUMP_PATH, contents);
  } catch {
  }
}

function discardDump(): void {
  dumpActive = false;
  try {
    fs.rmSync(DUMP_PATH, { force: true });
    if (fs.readdirSync(DATA_DIR).length === 0) {
      fs.rmdirSync(DATA_DIR);
    }
  } catch {
  }
}

const REQ_TIMEOUT_MS = 30_000;
const STREAM_TIMEOUT_MS = 180_000;

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36";

const uuid = () => crypto.randomUUID();

interface HttpResponse {
  status: number;
  headers: Record<string, any>;
  body: Buffer;
}

function httpReq(
  method: string,
  url: string,
  headers: Record<string, any> = {},
  body: string | object | null = null,
  timeoutMs = REQ_TIMEOUT_MS,
): Promise<HttpResponse> {
  let bodyBuf: Buffer | null = null;
  if (body !== null && body !== undefined) {
    bodyBuf = Buffer.from(
      typeof body === "string" ? body : JSON.stringify(body),
      "utf8",
    );
    headers = { ...headers, "content-length": String(bodyBuf.length) };
  }

  const attemptOnce = (): Promise<HttpResponse> =>
    new Promise((resolve, reject) => {
      const u = new URL(url);
      const agent = takeProxyAgent(`${method} ${u.pathname}`);

      const req = https.request(
        {
          method,
          hostname: u.hostname,
          path: u.pathname + u.search,
          headers,
          ...(agent ? { agent } : {}),
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c: Buffer) => chunks.push(c));
          res.on("end", () =>
            resolve({
              status: res.statusCode ?? 0,
              headers: res.headers as Record<string, any>,
              body: Buffer.concat(chunks),
            }),
          );
          res.on("error", reject);
        },
      );

      req.setTimeout(timeoutMs, () => {
        req.destroy(Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }));
      });
      req.on("error", reject);
      if (bodyBuf) req.write(bodyBuf);
      req.end();
    });

  return withProxyRetry(attemptOnce);
}

async function withProxyRetry<T>(attemptOnce: () => Promise<T>): Promise<T> {
  const attempts = proxyAttempts();
  let lastError: unknown = null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await attemptOnce();
    } catch (error) {
      lastError = error;
      if (attempt === attempts - 1 || !isRetryableNetworkError(error)) break;
    }
  }

  throw lastError;
}


interface ConfigData {
  deviceId: string | null;
  cookies: string;
  conversationId: string | null;
  parentMessageId: string | null;
}

class Config {
  private data: ConfigData = {
    deviceId: uuid(),
    cookies: process.env.CHATGPT_COOKIES ?? "",
    conversationId: null,
    parentMessageId: null,
  };

  get deviceId(): string {
    return this.data.deviceId ?? "";
  }

  get cookies(): string {
    return this.data.cookies;
  }

  set cookies(v: string) {
    this.data.cookies = v;
  }

  get conversationId(): string | null {
    return this.data.conversationId;
  }

  set conversationId(v: string | null) {
    this.data.conversationId = v;
  }

  get parentMessageId(): string | null {
    return this.data.parentMessageId;
  }

  set parentMessageId(v: string | null) {
    this.data.parentMessageId = v;
  }

  clearConversation(): void {
    this.data.conversationId = null;
    this.data.parentMessageId = null;
  }
}


function makeShim(opts: {
  cookieHeader: string;
  deviceId: string;
  evalScript: (code: string, filename: string) => any;
}): any {
  const { cookieHeader, deviceId, evalScript } = opts;
  const store: Record<string, string> = {};
  const __assign = Object.assign;
  const __rest = (s: any, e: string[]) => {
    const t: Record<string, any> = {};
    for (const p in s)
      if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0) t[p] = s[p];
    return t;
  };
  const decodeURIComponentShim = (s: string) => {
    try {
      return decodeURIComponent(s);
    } catch {
      return s;
    }
  };
  const encodeURIComponentShim = (s: string) => {
    try {
      return encodeURIComponent(s);
    } catch {
      return s;
    }
  };
  const atobShim = (s: any) => {
    const clean = String(s).replace(/[^A-Za-z0-9+/=]/g, "");
    return Buffer.from(clean, "base64").toString("binary");
  };
  const btoaShim = (s: any) => Buffer.from(String(s), "binary").toString("base64");

  const windowListeners: Record<string, Array<(e: any) => void>> = {};
  function dispatchWindowEvent(evt: any) {
    const ls = (windowListeners[evt.type] || []).slice();
    for (const f of ls) {
      try {
        f(evt);
      } catch {
      }
    }
  }

  class ShimEvent {
    type: string;
    target: any;
    currentTarget: any = null;
    defaultPrevented = false;
    constructor(type: string, init: any = {}) {
      this.type = type;
      this.target = init.target || null;
      Object.assign(this, init);
    }
    preventDefault() {
      this.defaultPrevented = true;
    }
    stopPropagation() {}
    stopImmediatePropagation() {}
    composedPath() {
      return this.target ? [this.target] : [];
    }
  }
  class ShimCustomEvent extends ShimEvent {
    detail: any;
    constructor(t: string, i: any = {}) {
      super(t, i);
      this.detail = i.detail;
    }
  }
  class ShimMessageEvent extends ShimEvent {
    data: any;
    origin: string;
    source: any;
    constructor(t: string, i: any = {}) {
      super(t, i);
      this.data = i.data;
      this.origin = i.origin || "";
      this.source = i.source || null;
    }
  }
  class ShimErrorEvent extends ShimEvent {
    message: string;
    error: any;
    constructor(t: string, i: any = {}) {
      super(t, i);
      this.message = i.message || "";
      this.error = i.error;
    }
  }

  class ShimEventTarget {
    _listeners: Record<string, Array<any>> = {};
    addEventListener(t: string, f: any) {
      if (!f) return;
      (this._listeners[t] = this._listeners[t] || []).push(f);
    }
    removeEventListener(t: string, f: any) {
      const a = this._listeners[t] || [];
      const i = a.indexOf(f);
      if (i >= 0) a.splice(i, 1);
    }
    dispatchEvent(e: any) {
      const ls = (this._listeners[e.type] || []).slice();
      e.target = e.target || this;
      e.currentTarget = this;
      for (const f of ls) {
        try {
          if (typeof f === "function") f.call(this, e);
          else if (f?.handleEvent) f.handleEvent(e);
        } catch {
        }
      }
      return !e.defaultPrevented;
    }
  }

  function makeIframe(): any {
    const contentWindow: any = {
      postMessage: (data: any) => {
        Promise.resolve().then(async () => {
          const { type, flow, requestId, p } = data || {};
          if (type !== "token" && type !== "init") return;
          let result: any = null;
          let error: string | null = null;
          try {
            const reqResp = await doSentinelReq(cookieHeader, deviceId, flow, p);
            result = { cachedChatReq: reqResp, cachedProof: p };
          } catch (e: any) {
            error = String(e.message || e);
          }
          const msgData: any = { type: "response", requestId };
          if (error) msgData.error = error;
          else msgData.result = result;
          dispatchWindowEvent({
            type: "message",
            data: msgData,
            source: contentWindow,
            origin: BASE,
          });
        });
      },
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => true,
    };

    const iframe: any = {
      tagName: "IFRAME",
      style: {},
      _src: "",
      _loaded: false,
      _loadListeners: [] as Array<(e: any) => void>,
      contentWindow,
      get src() {
        return iframe._src;
      },
      set src(v: any) {
        iframe._src = String(v);
        Promise.resolve().then(() => {
          iframe._loaded = true;
          for (const fn of iframe._loadListeners) {
            try {
              fn({ type: "load", target: iframe });
            } catch {
            }
          }
        });
      },
      setAttribute(k: string, v: any) {
        if (k === "src") iframe.src = v;
      },
      getAttribute(k: string) {
        return iframe[k] ?? null;
      },
      addEventListener(type: string, fn: any) {
        if (type === "load") iframe._loadListeners.push(fn);
      },
      removeEventListener() {},
      appendChild() {},
      removeChild() {},
    };
    return iframe;
  }

  class ShimHTMLElement extends ShimEventTarget {
    tagName: string;
    style: any = {};
    children: any[] = [];
    attributes: Record<string, string> = {};
    dataset: any = {};
    classList = {
      add: () => {},
      remove: () => {},
      contains: () => false,
      toggle: () => false,
    };
    _src = "";
    constructor(tag = "DIV") {
      super();
      this.tagName = tag;
    }
    appendChild(c: any) {
      this.children.push(c);
      return c;
    }
    removeChild(c: any) {
      const i = this.children.indexOf(c);
      if (i >= 0) this.children.splice(i, 1);
      return c;
    }
    insertBefore(c: any) {
      this.children.push(c);
      return c;
    }
    replaceChild(n: any, o: any) {
      this.removeChild(o);
      this.appendChild(n);
      return o;
    }
    setAttribute(k: string, v: any) {
      this.attributes[k] = String(v);
    }
    getAttribute(k: string) {
      return this.attributes[k] ?? null;
    }
    removeAttribute(k: string) {
      delete this.attributes[k];
    }
    hasAttribute(k: string) {
      return k in this.attributes;
    }
    getBoundingClientRect() {
      return { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 };
    }
    querySelector() {
      return null;
    }
    querySelectorAll() {
      return [];
    }
    remove() {}
    focus() {}
    blur() {}
    click() {}
  }

  class ShimCanvas extends ShimHTMLElement {
    width = 300;
    height = 150;
    constructor() {
      super("CANVAS");
    }
    getContext(): any {
      return null;
    }
    toDataURL() {
      return "data:image/png;base64,iVBORw0KGgo=";
    }
  }

  class ShimImage extends ShimEventTarget {
    width = 0;
    height = 0;
    naturalWidth = 0;
    naturalHeight = 0;
    _src = "";
    complete = false;
    set src(v: string) {
      this._src = v;
      this.complete = false;
      setTimeout(() => {
        this.complete = true;
        this.naturalWidth = this.naturalWidth || 1;
        this.naturalHeight = this.naturalHeight || 1;
        this.dispatchEvent(new ShimEvent("load"));
      }, 0);
    }
    get src() {
      return this._src;
    }
  }

  function fakeCanvasCtx(canvas: any): any {
    return {
      canvas,
      getImageData: (x = 0, y = 0, w = 1, h = 1) => ({
        data: new Uint8ClampedArray(w * h * 4).fill(120),
        width: w,
        height: h,
      }),
      fillText: () => {},
      fillRect: () => {},
      strokeText: () => {},
      strokeRect: () => {},
      measureText: (t = "") => ({ width: (String(t).length || 1) * 5.5 }),
      beginPath: () => {},
      closePath: () => {},
      arc: () => {},
      fill: () => {},
      stroke: () => {},
      moveTo: () => {},
      lineTo: () => {},
      bezierCurveTo: () => {},
      quadraticCurveTo: () => {},
      save: () => {},
      restore: () => {},
      translate: () => {},
      rotate: () => {},
      scale: () => {},
      drawImage: () => {},
      createLinearGradient: () => ({ addColorStop: () => {} }),
      createRadialGradient: () => ({ addColorStop: () => {} }),
      font: "10px sans-serif",
      textAlign: "start",
      textBaseline: "alphabetic",
      globalAlpha: 1,
      globalCompositeOperation: "source-over",
      fillStyle: "#000",
      strokeStyle: "#000",
      lineWidth: 1,
    };
  }

  class ShimPerformanceObserver {
    observe() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  }
  class ShimMutationObserver extends ShimPerformanceObserver {}

  const navigatorShim: any = {
    userAgent: UA,
    appVersion: UA.replace("Mozilla/", ""),
    appName: "Netscape",
    appCodeName: "Mozilla",
    product: "Gecko",
    productSub: "20030107",
    vendor: "Google Inc.",
    language: "en-US",
    languages: ["en-US", "en"],
    platform: "Win32",
    hardwareConcurrency: 16,
    deviceMemory: 16,
    maxTouchPoints: 0,
    webdriver: false,
    onLine: true,
    cookieEnabled: true,
    plugins: Object.assign([], { length: 0 }),
    mimeTypes: Object.assign([], { length: 0 }),
    userAgentData: {
      brands: [
        { brand: "Chromium", version: "152" },
        { brand: "Not?A_Brand", version: "24" },
        { brand: "Google Chrome", version: "152" },
      ],
      mobile: false,
      platform: "Windows",
      getHighEntropyValues: async () => ({
        architecture: "x86",
        bitness: "64",
        model: "",
        platformVersion: "15.0.0",
        uaFullVersion: "152.0.0.0",
        fullVersionList: [
          { brand: "Chromium", version: "152.0.0.0" },
          { brand: "Not?A_Brand", version: "24.0.0.0" },
          { brand: "Google Chrome", version: "152.0.0.0" },
        ],
      }),
    },
    connection: { effectiveType: "4g", rtt: 50, downlink: 10, saveData: false },
    sendBeacon: () => true,
    javaEnabled: () => false,
  };

  const screenShim = {
    width: 1920,
    height: 1080,
    availWidth: 1920,
    availHeight: 1040,
    colorDepth: 24,
    pixelDepth: 24,
  };

  const locationObj = {
    href: BASE + "/",
    origin: BASE,
    hostname: "chatgpt.com",
    protocol: "https:",
    pathname: "/",
    search: "",
    hash: "",
    port: "",
  };

  function makeScriptEl(): any {
    const el: any = new ShimHTMLElement("SCRIPT");
    el.type = "";
    el.async = false;
    el.defer = false;
    el.onload = null;
    el.onerror = null;
    el.onreadystatechange = null;
    el.readyState = "loading";
    el._fired = false;
    el.setAttribute = (k: string, v: any) => {
      el.attributes[k] = String(v);
      if (k === "src") el.src = v;
    };
    el.getAttribute = (k: string) =>
      k === "src" ? el._src : (el.attributes[k] ?? null);
    el.remove = () => {};
    el.appendChild = () => {};
    Object.defineProperty(el, "src", {
      get() {
        return el._src;
      },
      set(v: string) {
        el._src = String(v);
        triggerScript(el._src, el);
      },
    });
    return el;
  }

  function triggerScript(v: string, el: any): void {
    if (!v) return;
    Promise.resolve().then(async () => {
      try {
        const abs = new URL(v, BASE).toString();
        const res = await httpReq(
          "GET",
          abs,
          { "user-agent": UA, accept: "*/*", referer: BASE + "/", cookie: cookieHeader },
          null,
          15_000,
        );
        const code = res.body.toString("utf8");
        appendDump(`\n/* === ${abs} === */\n${code}\n`);
        if (res.status === 200) {
          try {
            evalScript(code, abs);
          } catch {
          }
        }
        el.readyState = "complete";
        try {
          el.onreadystatechange?.(new ShimEvent("readystatechange", { target: el }));
        } catch {
        }
        try {
          el.onload?.(new ShimEvent("load", { target: el }));
        } catch {
        }
      } catch {
        try {
          el.onerror?.(new ShimErrorEvent("error", { message: "load failed" }));
        } catch {
        }
      }
    });
  }

  const doc: any = {
    cookie: cookieHeader,
    referrer: BASE + "/",
    readyState: "complete",
    visibilityState: "visible",
    hidden: false,
    title: "ChatGPT",
    characterSet: "UTF-8",
    URL: BASE + "/",
    location: locationObj,
    get currentScript() {
      return null;
    },
    createElement: (tag: string) => {
      const t = String(tag).toLowerCase();
      if (t === "script") return makeScriptEl();
      if (t === "iframe") return makeIframe();
      if (t === "canvas") {
        const c = new ShimCanvas();
        c.getContext = () => fakeCanvasCtx(c);
        return c;
      }
      return new ShimHTMLElement(t.toUpperCase());
    },
    createElementNS: (_ns: string, tag: string) => doc.createElement(tag),
    createDocumentFragment: () => new ShimHTMLElement("#fragment"),
    createTextNode: (s: any) => ({ nodeType: 3, textContent: String(s) }),
    documentElement: Object.assign(new ShimHTMLElement("HTML"), {
      clientWidth: 1920,
      clientHeight: 1080,
    }),
    body: Object.assign(new ShimHTMLElement("BODY"), {
      clientWidth: 1920,
      clientHeight: 1080,
    }),
    head: Object.assign(new ShimHTMLElement("HEAD"), {
      appendChild: (child: any) => {
        if (child && child.tagName === "SCRIPT" && child._src && !child._fired) {
          child._fired = true;
          triggerScript(child._src, child);
        }
        return child;
      },
    }),
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true,
    getElementsByTagName: () => [],
    getElementsByClassName: () => [],
    querySelector: () => null,
    querySelectorAll: () => [],
    scripts: [],
    fonts: { ready: Promise.resolve(), check: () => true },
    hasFocus: () => true,
  };

  const perf: any = {
    now: () => Number(process.hrtime.bigint() / 1000n) / 1000,
    timeOrigin: Date.now() - 100,
    getEntries: () => [],
    getEntriesByType: () => [],
    getEntriesByName: () => [],
    mark: () => {},
    measure: () => {},
    clearMarks: () => {},
    clearMeasures: () => {},
    memory: {
      jsHeapSizeLimit: 4294705152,
      totalJSHeapSize: 30_000_000,
      usedJSHeapSize: 20_000_000,
    },
  };

  const storageShim = {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: any) => {
      store[k] = String(v);
    },
    removeItem: (k: string) => {
      delete store[k];
    },
    clear: () => {
      for (const k of Object.keys(store)) delete store[k];
    },
    key: (i: number) => Object.keys(store)[i] ?? null,
    get length() {
      return Object.keys(store).length;
    },
  };

  const globals: any = {
    __assign,
    __rest,
    __spreadArray: (a: any[], b: any[]) => a.concat(b),
    __read: (o: any, n?: number) => {
      const it = o[Symbol.iterator]?.();
      const outArr: any[] = [];
      if (!it) return o;
      let r;
      while (!(r = it.next()).done && (n === undefined || n-- > 0)) outArr.push(r.value);
      return outArr;
    },
    __extends: (d: any, b: any) => {
      for (const p in b)
        if (Object.prototype.hasOwnProperty.call(b, p)) d[p] = b[p];
      function Ctor(this: any) {
        this.constructor = d;
      }
      d.prototype = b === null ? Object.create(b) : ((Ctor.prototype = b.prototype), new (Ctor as any)());
    },
    __awaiter: function (
      thisArg: any,
      _args: any,
      P: any,
      gen: any,
    ): Promise<any> {
      return new (P || (P = Promise))((resolve: any, reject: any) => {
        function step(op: any) {
          try {
            const r = gen[op[0]](op[1]);
            r.done ? resolve(r.value) : new P((res: any) => res(r.value)).then(fulfilled, rejected);
          } catch (e) {
            reject(e);
          }
        }
        function fulfilled(v: any) {
          try {
            step(gen.next(v));
          } catch (e) {
            reject(e);
          }
        }
        function rejected(v: any) {
          try {
            step(gen["throw"](v));
          } catch (e) {
            reject(e);
          }
        }
        step((gen = gen.apply(thisArg, _args || [])).next());
      });
    },
    __generator: function () {},
    __decorate: (decorators: any[], target: any, key?: any, desc?: any) => {
      let r = arguments.length,
        c =
          r < 3
            ? target
            : desc === null
              ? (desc = Object.getOwnPropertyDescriptor(target, key))
              : desc,
        d;
      if (typeof Reflect === "object" && (Reflect as any).decorate)
        return (Reflect as any).decorate(decorators, target, key, desc);
      for (let i = decorators.length - 1; i >= 0; i--)
        if ((d = decorators[i]))
          r = (r < 3 ? d(c) : r > 3 ? d(target, key, c) : d(target, key)) || c;
      return r > 3 && c && Object.defineProperty(target, key, c), r;
    },
    __param: () => () => {},
    __metadata: () => {},

    decodeURIComponent: decodeURIComponentShim,
    encodeURIComponent: encodeURIComponentShim,
    decodeURI: (s: string) => {
      try {
        return decodeURI(s);
      } catch {
        return s;
      }
    },
    encodeURI: (s: string) => {
      try {
        return encodeURI(s);
      } catch {
        return s;
      }
    },
    atob: atobShim,
    btoa: btoaShim,

    Event: ShimEvent,
    CustomEvent: ShimCustomEvent,
    MessageEvent: ShimMessageEvent,
    ErrorEvent: ShimErrorEvent,
    EventTarget: ShimEventTarget,
    HTMLElement: ShimHTMLElement,
    HTMLCanvasElement: ShimCanvas,
    Image: ShimImage,
    PerformanceObserver: ShimPerformanceObserver,
    MutationObserver: ShimMutationObserver,
    Navigator: class Navigator {},
    Screen: class Screen {},
    HTMLScriptElement: class HTMLScriptElement extends ShimHTMLElement {},

    navigator: navigatorShim,
    screen: screenShim,
    performance: perf,
    location: locationObj,
    localStorage: storageShim,
    sessionStorage: storageShim,
    document: doc,
    history: {
      length: 2,
      state: null,
      pushState: () => {},
      replaceState: () => {},
      back: () => {},
      forward: () => {},
    },

    crypto: {
      getRandomValues: (a: any) => crypto.randomFillSync(a),
      randomUUID: () => crypto.randomUUID(),
      subtle: crypto.subtle,
    },

    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    setImmediate,
    clearImmediate,
    queueMicrotask,
    console,

    TextEncoder,
    TextDecoder,
    URL,
    URLSearchParams,
    Promise,
    Math,
    JSON,
    Date,
    Object,
    Array,
    String,
    Number,
    Boolean,
    Symbol,
    BigInt,
    Error,
    TypeError,
    RangeError,
    ReferenceError,
    SyntaxError,
    URIError,
    Reflect,
    Proxy,
    Map,
    Set,
    WeakMap,
    WeakSet,
    Uint8Array,
    Uint8ClampedArray,
    Uint16Array,
    Uint32Array,
    Int8Array,
    Int16Array,
    Int32Array,
    Float32Array,
    Float64Array,
    ArrayBuffer,
    DataView,

    fetch: (input: any, init?: any) => proxiedFetch(input, init),
    AbortController,
    AbortSignal,

    isSecureContext: true,
    origin: BASE,
    innerWidth: 1920,
    innerHeight: 991,
    outerWidth: 1920,
    outerHeight: 1080,
    devicePixelRatio: 1,
    name: "",
    addEventListener: (t: string, f: any) => {
      if (!f) return;
      (windowListeners[t] = windowListeners[t] || []).push(f);
    },
    removeEventListener: (t: string, f: any) => {
      const a = windowListeners[t] || [];
      const i = a.indexOf(f);
      if (i >= 0) a.splice(i, 1);
    },
    dispatchEvent: (e: any) => {
      dispatchWindowEvent(e);
      return true;
    },
    getComputedStyle: () => ({ getPropertyValue: () => "" }),
    requestAnimationFrame: (cb: any) => setTimeout(() => cb(perf.now()), 16),
    cancelAnimationFrame: clearTimeout,
    requestIdleCallback: (cb: any) =>
      setTimeout(() => cb({ timeRemaining: () => 1, didTimeout: false }), 0),
    cancelIdleCallback: clearTimeout,
    matchMedia: () => ({
      matches: false,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
    postMessage: () => {},
  };

  const handler: ProxyHandler<any> = {
    get(t, prop) {
      return prop in t ? t[prop] : undefined;
    },
    has(t, prop) {
      return prop in t;
    },
  };

  const proxy = new Proxy(globals, handler);
  globals.window = proxy;
  globals.self = proxy;
  globals.globalThis = proxy;
  globals.top = proxy;
  globals.parent = proxy;
  globals.frames = proxy;
  globals.opener = null;

  return proxy;
}

async function doSentinelReq(
  cookieHeader: string,
  deviceId: string,
  flow: any,
  proof: any,
): Promise<any> {
  const flowVal = typeof flow === "string" && flow.length > 0 ? flow : "__default__";
  const body = JSON.stringify({ p: proof, id: deviceId, flow: flowVal });
  const url = BASE + "/backend-api/sentinel/req";

  const res = await httpReq(
    "POST",
    url,
    {
      "user-agent": UA,
      accept: "*/*",
      "content-type": "application/json",
      cookie: cookieHeader,
      origin: BASE,
      referer: BASE + "/",
      "oai-device-id": deviceId,
      "sec-ch-ua": '"Chromium";v="152", "Not?A_Brand";v="24", "Google Chrome";v="152"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"Windows"',
      "sec-fetch-site": "same-origin",
      "sec-fetch-mode": "cors",
      "sec-fetch-dest": "empty",
    },
    body,
    15_000,
  );

  const txt = res.body.toString("utf8");
  if (res.status !== 200) throw new Error(`sentinel req ${res.status}`);
  try {
    return JSON.parse(txt);
  } catch {
    return { token: txt };
  }
}


interface SentinelCache {
  key: string;
  ctx: any;
}

let sharedSentinelCache: SentinelCache | null = null;

class SentinelSolver {
  ctx: any = null;
  private loaded = false;
  private cacheKey = "";

  constructor(private readonly cfg: Config) {}

  private cookieHeader(): string {
    const parts = [`oai-did=${this.cfg.deviceId}`];
    if (this.cfg.cookies) parts.push(this.cfg.cookies);
    return parts.join("; ");
  }

  invalidate(): void {
    this.loaded = false;
    this.ctx = null;
    this.cacheKey = "";
    sharedSentinelCache = null;
  }

  get isReady(): boolean {
    const key = this.cookieHeader();
    if (this.loaded && this.ctx && this.cacheKey === key) return true;
    return sharedSentinelCache !== null && sharedSentinelCache.key === key;
  }

  async load(): Promise<boolean> {
    const key = this.cookieHeader();

    if (this.loaded && this.ctx && this.cacheKey === key) return false;

    if (sharedSentinelCache && sharedSentinelCache.key === key) {
      this.ctx = sharedSentinelCache.ctx;
      this.cacheKey = key;
      this.loaded = true;
      return false;
    }

    dumpActive = true;

    const res = await httpReq(
      "GET",
      `${BASE}/backend-api/sentinel/sdk.js`,
      {
        "user-agent": UA,
        accept: "*/*",
        "accept-language": "en-US,en;q=0.9",
        referer: BASE + "/",
        cookie: this.cookieHeader(),
        "sec-ch-ua": '"Chromium";v="152", "Not?A_Brand";v="24", "Google Chrome";v="152"',
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"Windows"',
        "sec-fetch-site": "same-origin",
        "sec-fetch-mode": "no-cors",
        "sec-fetch-dest": "script",
      },
      null,
      15_000,
    );

    if (res.status !== 200) throw new Error(`loader ${res.status}`);

    const loaderSrc = res.body.toString("utf8");
    writeDump(loaderSrc);

    const evalScript = (code: string, filename: string) => {
      const script = new vm.Script(code, { filename });
      return script.runInContext(this.ctx, { timeout: 30_000 });
    };

    const shim = makeShim({
      cookieHeader: this.cookieHeader(),
      deviceId: this.cfg.deviceId,
      evalScript,
    });

    this.ctx = vm.createContext(shim);

    try {
      vm.runInContext(loaderSrc, this.ctx, {
        filename: "sentinel-loader.js",
        timeout: 8000,
      });
    } catch (e: any) {
      throw new Error(`loader eval: ${e.message}`);
    }

    this.cacheKey = key;
    this.loaded = true;
    sharedSentinelCache = { key, ctx: this.ctx };
    return true;
  }

  async mintProof(): Promise<{ proof: string; chatReq: string; turnstile: string }> {
    let downloaded = false;
    try {
      downloaded = await this.load();
    } catch (error) {
      discardDump();
      throw error;
    }

    try {
      const sdk = this.ctx.SentinelSDK;
      if (!sdk) {
        this.invalidate();
        throw new Error("sdk unavailable");
      }

      const raw = await sdk.token();

      let parsed: any = null;
      if (typeof raw === "string") {
        try {
          parsed = JSON.parse(raw);
        } catch {
        }
      } else if (raw && typeof raw === "object") {
        parsed = raw;
      }

      if (!parsed || typeof parsed !== "object") throw new Error("token response invalid");
      if (parsed.e) throw new Error(`sdk: ${parsed.e}`);

      const proof = typeof parsed.p === "string" ? parsed.p : "";
      const chatReq = typeof parsed.c === "string" ? parsed.c : "";
      const turnstile = typeof parsed.t === "string" && parsed.t.length > 0 ? parsed.t : "";

      if (!proof) throw new Error("no proof token");
      return { proof, chatReq, turnstile };
    } catch (error) {
      if (!downloaded) this.invalidate();
      throw error;
    } finally {
      discardDump();
    }
  }
}


interface ChatHandlers {
  onDelta?: (delta: string) => void;
  onResponse?: (status: number) => void;
  onFirstByte?: (ms: number) => void;
}

interface ChatResponse {
  text: string;
  messageId: string | null;
  conversationId: string | null;
  chunks: number;
  bytes: number;
  firstByteMs: number;
}

class ChatGPT {
  readonly solver: SentinelSolver;
  private activeReq: any = null;
  private tokens = { proof: "", chatReq: "", turnstile: "" };
  readonly sessionId = uuid();

  constructor(private readonly cfg: Config) {
    this.solver = new SentinelSolver(cfg);
  }

  abortActive(): void {
    if (this.activeReq) {
      try {
        this.activeReq.destroy(new Error("aborted"));
      } catch {
      }
      this.activeReq = null;
    }
  }

  clear(): void {
    this.cfg.clearConversation();
  }

  get conversationId(): string | null {
    return this.cfg.conversationId;
  }

  get deviceId(): string {
    return this.cfg.deviceId;
  }

  private baseHeaders(): Record<string, any> {
    const parts = [`oai-did=${this.cfg.deviceId}`];
    if (this.cfg.cookies) parts.push(this.cfg.cookies);
    return {
      "user-agent": UA,
      "accept-language": "en-US,en;q=0.9",
      "oai-device-id": this.cfg.deviceId,
      "oai-session-id": this.sessionId,
      "oai-client-build-number": "10781678",
      "oai-client-version": "prod-82fb0cf2a28d819222c39fdae72e06b13fd59cf2",
      "oai-language": "en-US",
      origin: BASE,
      referer: BASE + "/",
      "sec-ch-ua": '"Chromium";v="152", "Not?A_Brand";v="24", "Google Chrome";v="152"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"Windows"',
      cookie: parts.join("; "),
    };
  }

  async refreshTokens(): Promise<void> {
    const minted = await this.solver.mintProof();
    if (!minted.proof || !minted.chatReq) throw new Error("incomplete token set");
    this.tokens.proof = minted.proof;
    this.tokens.chatReq = minted.chatReq;
    this.tokens.turnstile = minted.turnstile || "";
  }

  async chat(
    prompt: string,
    handlers: ChatHandlers = {},
    options: { skipRefresh?: boolean } = {},
  ): Promise<ChatResponse> {
    if (!options.skipRefresh) await this.refreshTokens();

    const attempts = Math.max(proxyAttempts(), 2);
    let lastError: any = null;

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        return await this.chatOnce(prompt, handlers);
      } catch (e: any) {
        lastError = e;
        if (/HTTP 403/.test(String(e?.message))) {
          await this.refreshTokens();
          continue;
        }
        if (attempt === attempts - 1 || !isRetryableNetworkError(e)) break;
      }
    }

    throw lastError;
  }

  private chatOnce(prompt: string, handlers: ChatHandlers): Promise<ChatResponse> {
    const started = Date.now();
    const body = {
      action: "next",
      messages: [
        {
          id: uuid(),
          author: { role: "user" },
          create_time: Date.now() / 1000,
          content: { content_type: "text", parts: [prompt] },
          metadata: {
            serialization_metadata: { custom_symbol_offsets: [] },
            submission_mode: "manual_send",
          },
        },
      ],
      parent_message_id: this.cfg.parentMessageId || "client-created-root",
      model: "auto",
      client_prepare_state: "failure",
      timezone_offset_min: -new Date().getTimezoneOffset(),
      timezone: "Asia/Jerusalem",
      conversation_mode: { kind: "primary_assistant" },
      enable_message_followups: true,
      system_hints: [],
      supports_buffering: true,
      supported_encodings: ["v1"],
      client_contextual_info: {
        is_dark_mode: true,
        time_since_loaded: 25,
        page_height: 991,
        page_width: 1920,
        pixel_ratio: 1,
        screen_height: 1080,
        screen_width: 1920,
        app_name: "chatgpt.com",
        has_web_push_capabilities: true,
        web_push_notification_permission: "default",
      },
      no_auth_ad_preferences: {
        personalization_enabled: true,
        history_enabled: true,
        bazaar_consent_set: false,
      },
      paragen_cot_summary_display_override: "allow",
      force_parallel_switch: "auto",
    };

    const headers: Record<string, any> = {
      ...this.baseHeaders(),
      "content-type": "application/json",
      accept: "text/event-stream",
      "x-openai-web-sse-compression": "identity",
      "x-openai-target-path": "/backend-api/f/conversation",
      "x-openai-target-route": "/backend-api/f/conversation",
      "x-oai-turn-trace-id": uuid(),
      "oai-genui-client-actions": "open_entity_detail",
      "openai-sentinel-proof-token": this.tokens.proof,
      "openai-sentinel-chat-requirements-token": this.tokens.chatReq,
      "oai-echo-logs": "0,2226,1,3094,0,4821,1,4910,0,13908,1,14394,0,16003,1,16971,0,18200,1,20117",
    };
    if (this.tokens.turnstile) {
      headers["openai-sentinel-turnstile-token"] = this.tokens.turnstile;
    }

    return new Promise<ChatResponse>((resolve, reject) => {
      let settled = false;
      const settleResolve = (value: ChatResponse) => {
        if (settled) return;
        settled = true;
        this.activeReq = null;
        resolve(value);
      };
      const settleReject = (error: Error) => {
        if (settled) return;
        settled = true;
        this.activeReq = null;
        reject(error);
      };

      const bodyBuf = Buffer.from(JSON.stringify(body), "utf8");
      headers["content-length"] = String(bodyBuf.length);
      const url = new URL(BASE + "/backend-anon/f/conversation");
      const proxyAgent = takeProxyAgent("POST /backend-anon/f/conversation");

      const req = https.request(
        {
          method: "POST",
          hostname: url.hostname,
          path: url.pathname,
          headers,
          ...(proxyAgent ? { agent: proxyAgent } : {}),
        },
        (res) => {
          if (res.statusCode !== 200) {
            let err = "";
            res.on("data", (c: Buffer) => (err += c));
            res.on("end", () =>
              settleReject(new Error(`HTTP ${res.statusCode}: ${err.slice(0, 500)}`)),
            );
            return;
          }

          handlers.onResponse?.(res.statusCode);

          let buf = "";
          let full = "";
          let msgId: string | null = null;
          let conversationId: string | null = null;
          let chunks = 0;
          let bytes = 0;
          let firstByteMs = 0;

          const streamTimer = setTimeout(() => {
            if (!settled) {
              try {
                req.destroy(new Error("stream timeout"));
              } catch {
              }
            }
          }, STREAM_TIMEOUT_MS);

          this.activeReq = req;

          const appendDelta = (chunk: string) => {
            if (typeof chunk !== "string" || chunk.length === 0) return;
            if (firstByteMs === 0) {
              firstByteMs = Date.now() - started;
              handlers.onFirstByte?.(firstByteMs);
            }
            full += chunk;
            handlers.onDelta?.(chunk);
          };

          const absorbMessage = (m: any) => {
            if (!m || !m.author || m.author.role !== "assistant") return;
            if (m.id) msgId = m.id;
            const parts = m.content?.parts;
            if (!Array.isArray(parts)) return;
            const text = parts.filter((p: any) => typeof p === "string").join("");
            if (!text) return;
            if (text.length > full.length && text.startsWith(full)) {
              appendDelta(text.slice(full.length));
            }
          };

          res.on("data", (chunk: Buffer) => {
            chunks += 1;
            bytes += chunk.byteLength;
            buf += chunk.toString("utf8");

            let idx: number;
            while ((idx = buf.indexOf("\n\n")) !== -1) {
              const raw = buf.slice(0, idx);
              buf = buf.slice(idx + 2);

              let event: string | null = null;
              const dataLines: string[] = [];

              for (const line of raw.split("\n")) {
                if (line.startsWith("event:")) {
                  let v = line.slice(6);
                  if (v.startsWith(" ")) v = v.slice(1);
                  event = v.trim();
                } else if (line.startsWith("data:")) {
                  let v = line.slice(5);
                  if (v.startsWith(" ")) v = v.slice(1);
                  dataLines.push(v);
                }
              }

              if (!event && dataLines.length === 0) continue;

              let data: any = null;
              try {
                data = dataLines.length ? JSON.parse(dataLines.join("\n")) : null;
              } catch {
                continue;
              }
              if (!data) continue;

              if (typeof data.conversation_id === "string") {
                conversationId = data.conversation_id;
              }

              if (event === "server_ste_metadata" && data.metadata?.message_id) {
                msgId = data.metadata.message_id;
                continue;
              }
              if (event !== "delta" && event !== null) continue;

              if (typeof data.v === "string") {
                appendDelta(data.v);
                continue;
              }

              if (Array.isArray(data.v)) {
                for (const p of data.v) {
                  if (!p || typeof p !== "object") continue;
                  if (typeof p.v === "string" && (p.o === "append" || p.o === "add" || !p.o)) {
                    if (p.p && !String(p.p).includes("content/parts")) continue;
                    appendDelta(p.v);
                  }
                }
                continue;
              }

              if (data.v && typeof data.v === "object") {
                if (data.v.message) absorbMessage(data.v.message);
                continue;
              }
            }
          });

          res.on("error", (e: Error) => {
            clearTimeout(streamTimer);
            settleReject(e);
          });

          res.on("end", () => {
            clearTimeout(streamTimer);
            if (conversationId) this.cfg.conversationId = conversationId;
            if (msgId) this.cfg.parentMessageId = msgId;
            settleResolve({
              text: full,
              messageId: msgId,
              conversationId,
              chunks,
              bytes,
              firstByteMs,
            });
          });
        },
      );

      req.setTimeout(REQ_TIMEOUT_MS, () => {
        req.destroy(Object.assign(new Error("connect timeout"), { code: "ETIMEDOUT" }));
      });
      req.on("error", (e: Error) => settleReject(e));
      req.write(bodyBuf);
      req.end();
    });
  }
}


export class GptProvider implements ChatProvider {
  readonly id = "gpt";
  readonly model = "gpt-6";
  readonly provider = "openai";
  readonly supportsSystem = false;

  private readonly client: ChatGPT;
  private readonly log: ChatMessage[] = [];

  constructor() {
    this.client = new ChatGPT(new Config());
  }

  async send(text: string, handlers: SendHandlers = {}): Promise<ChatResult> {
    const started = Date.now();
    const emit = handlers.onEvent;

    emit?.({
      type: "pending",
      label: "sentinel",
      detail: this.client.solver.isReady
        ? "sentinel sdk · cached"
        : "GET /backend-api/sentinel/sdk.js",
    });
    const loadStart = Date.now();
    const downloaded = await this.client.solver.load();
    emit?.({
      type: "stage",
      label: "sdk",
      detail: downloaded ? `loaded · ${Date.now() - loadStart}ms` : "cached in memory",
    });

    emit?.({ type: "pending", label: "proof", detail: "minting sentinel token" });
    const proofStart = Date.now();
    await this.client.refreshTokens();
    emit?.({ type: "stage", label: "proof", detail: `minted · ${Date.now() - proofStart}ms` });

    emit?.({
      type: "pending",
      label: "request",
      detail: "POST /backend-anon/f/conversation",
    });

    const res = await this.client.chat(
      text,
      {
        onResponse: (status) =>
          emit?.({
            type: "stage",
            label: "response",
            detail: `${status} · text/event-stream`,
          }),
        onFirstByte: (ms) => emit?.({ type: "first-byte", ms }),
        onDelta: handlers.onDelta,
      },
      { skipRefresh: true },
    );

    emit?.({
      type: "done",
      chunks: res.chunks,
      bytes: res.bytes,
      ms: Date.now() - started,
      note: res.conversationId ? `conv ${res.conversationId.slice(0, 8)}` : undefined,
    });

    this.log.push({ role: "user", content: text });
    this.log.push({ role: "assistant", content: res.text });

    return { text: res.text, chunks: res.chunks, bytes: res.bytes };
  }

  reset(): void {
    this.client.clear();
    this.log.length = 0;
  }

  history(): readonly ChatMessage[] {
    return this.log;
  }

  info(): Array<[string, string]> {
    return [
      ["endpoint", "chatgpt.com · /backend-anon/f/conversation"],
      ["transport", "POST · https · event-stream"],
      ["sentinel", "sdk.js · proof-of-work minted locally"],
      ["proxy", proxyDetail()],
      ["routing", proxyUsage()],
      ["model", "gpt-6 (auto-routed)"],
      ["device", this.client.deviceId],
      ["conversation", this.client.conversationId ?? "—"],
    ];
  }
}
