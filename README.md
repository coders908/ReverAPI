# rever

A terminal chat client with two model backends behind one interface. No API keys: both providers talk to the same web endpoints their browser clients use, and every stage of the request is rendered as it happens.

```
npm install
npm run dev
```

```
  rever · gpt-6 ▸ what is a race condition?

  ▎ you
  what is a race condition?

  ● sdk        loaded · 425ms
  ● proof      minted · 1581ms
  ● response   200 · text/event-stream

  ▎ answer
  │ A race condition is when two threads touch shared state in an order
  │ you didn't control, so the result depends on timing.

  ↳ 19 chunks · 12.2 KB · 14.88s total · first byte 6.13s · 35 chars · conv 6af9fb09
```

## Models

| id | model | vendor | transport |
| --- | --- | --- | --- |
| `gemini` | gemini 3.5 flash lite | google | `POST /StreamGenerate` · cookie-free |
| `gpt` | gpt-6 | openai | `POST /backend-anon/f/conversation` · sentinel proof |

Switch mid-session with `/model gpt` (or `/model 2`); `/model` alone lists them. Each provider keeps its own conversation context.

## How it works

Common contract in `providers/types.ts` — a provider only has to emit `pending` / `stage` / `delta` / `done` events, so the UI stays identical for every backend.

**Gemini** (`providers/gemini/gemini.ts`)
1. Flattens the conversation into `User:` / `Assistant:` turns and posts `f.req` to the web endpoint — no cookies, no tokens.
2. Reads the body as a stream and extracts the newest answer frame (`rc_` envelope, with two fallbacks).
3. Emits only the delta, so the answer prints as it arrives.

**GPT-6** (`providers/gpt/gpt.ts`)
1. Downloads the sentinel SDK and executes it inside a `node:vm` context with a browser shim (DOM, canvas, iframe, crypto, storage).
2. The evaluated SDK is kept in memory, so only the first message of a session downloads it; later messages reuse the same VM context.
3. While it runs, the downloaded sources are dumped to `data/sentinel-sdk.dump.js`; the file is deleted as soon as the proof is minted, so it never outlives a request.
4. Mints a proof-of-work token locally, exchanges it with `/sentinel/req`, and builds the `openai-sentinel-*` headers.
5. Streams `/backend-anon/f/conversation` as SSE, parses `event:` / `data:` frames and emits text deltas.
6. Persists `deviceId`, cookies and the conversation ids in `config.json`.

## Commands

| command | effect |
| --- | --- |
| `/model [id\|n]` | list or switch model provider |
| `/help` | list commands |
| `/new` | drop the conversation context |
| `/history` | print the current conversation |
| `/system <text>` | set a system prompt (gemini only) |
| `/info` | endpoint, transport, context size |
| `/clear` | redraw the console |
| `/exit` | close the session |

Plain text is sent to the active model.

## Configuration

| variable / file | purpose |
| --- | --- |
| `GEMINI_BL` | gemini web-server build id (bump it if Google rotates the build) |
| `REVER_SYSTEM_PROMPT` | default system prompt for gemini |
| `config.json` | gpt device id, optional cookies, conversation ids |

`config.json` is created automatically on first use and is git-ignored. To use an authenticated ChatGPT account, set `cookies` to a raw cookie header (e.g. `__Secure-next-auth.session-token=…`); without it the anonymous endpoint is used.

## Layout

```
src/index.ts                terminal UI: banner, prompt, live pipeline renderer
src/models.ts               model registry and provider factories
providers/types.ts          shared provider contract
providers/gemini/gemini.ts  gemini web endpoint
providers/gpt/gpt.ts        chatgpt sentinel pipeline
```

TypeScript strict, ESM, executed directly with `tsx`.
