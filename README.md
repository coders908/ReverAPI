<div align="center">

<h1>ReverAPI</h1>

<p>An experimental TypeScript CLI that provides an interactive chat experience
with Gemini and GPT through reverse engineered web communication protocols.</p>

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/Version-1.0.0-blue.svg)](package.json)
[![Node](https://img.shields.io/badge/Node-20%2B-brightgreen.svg)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org)

</div>

![ReverAPI running in a terminal](public/cmd.png)

## Overview

ReverAPI explores how browser based AI applications communicate with their
backend services, and demonstrates how those communication patterns can be
reproduced in a terminal based chat client.

In practice the console behaves like any other chat client: pick a model, type
a message, and watch the reply stream in. What makes it worth reading is the
layer underneath. There are no vendor SDKs involved. Each provider is a hand
written implementation of a protocol that was reconstructed by observing a
browser session, so every header, payload field and stream frame is visible in
the source instead of being hidden inside a dependency.

Everything is plain TypeScript on top of Node, so there is no build step and no
compiled output to manage.

## Technical focus

The project is a study of five problems, each handled explicitly:

| Area | What the code actually does |
| --- | --- |
| HTTP communication | Builds the request a browser session makes, down to its headers and same domain markers. |
| Request serialization | Encodes a conversation into the positional or keyed payload shape each service expects. |
| Response parsing | Turns length prefixed frames and event streams back into text, including nested JSON strings. |
| Streaming | Consumes the body incrementally so text appears while the answer is still being produced. |
| Provider abstraction | Keeps both transports behind one interface, so the console knows nothing about either vendor. |

Around those five sit the concerns a real client needs: retry and rotation
across a proxy pool, cancellation and timeouts, error surfacing, session state,
and a terminal layout that stays readable at any window size.

## Features

- **Two models, one prompt.** Switch between Gemini and GPT with `/model`.
- **Streaming answers.** Tokens are printed as they arrive, wrapped to the
  current window width.
- **Responsive layout.** The header, rules, tables and prompt adapt to any
  terminal size, from a narrow split pane to a full screen.
- **Proxy pool with rotation.** Every request moves to the next entry in
  `proxy.txt`, retrying across the pool when a proxy fails.
- **Session state in memory.** Conversation history, the system prompt and the
  loaded config stay in RAM only.
- **Citation filtering.** The opaque `googleusercontent.com` links Gemini
  appends are stripped from the stream, while ordinary links are kept.
- **Live request telemetry.** Each answer reports chunks, bytes, total time and
  time to first byte.

## Requirements

- Node.js 20 or newer
- npm

## Getting started

```bash
git clone https://github.com/coders908/ReverAPI.git
cd ReverAPI
npm install
```

Start the console:

```bash
npm run dev
```

The header redraws and you land on the prompt:

```
▎ rever · gemini 3.5 ▸
```

Type a message and press Enter. Anything that is not a command is sent to the
active model.

### Commands

| Command | Description |
| --- | --- |
| `/model` | List providers and switch model |
| `/model gpt` | Switch by id, or `/model 2` by number |
| `/new` | Drop the conversation context |
| `/history` | Print the current conversation |
| `/system <text>` | Set a system prompt (Gemini only) |
| `/info` | Show endpoint, transport and proxy routing |
| `/clear` | Redraw the console |
| `/exit` | Close the session |

## Proxies

Proxy routing is on automatically when the app runs through `npm run dev`.
Create `proxy.txt` in the project root with one entry per line:

```text
host:port
user:pass@host:port
http://user:pass@host:port
```

See [proxy.example.txt](proxy.example.txt) for the full format. Blank lines and
lines starting with `#` are ignored. If the file is missing, the client falls
back to a direct connection instead of failing.

## Configuration

Configuration is read from environment variables. Nothing is written to disk.

| Variable | Default | Purpose |
| --- | --- | --- |
| `REVER_PROXY` | on under `npm run dev` | `1` or `0` to force proxy routing on or off |
| `REVER_PROXY_FILE` | `./proxy.txt` | Path to the proxy list |
| `REVER_SYSTEM_PROMPT` | none | System prompt sent to Gemini on startup |

Example:

```bash
REVER_PROXY=0 npm run dev
```

## Project layout

```text
src/
  index.ts        console, layout, prompt and command handling
  models.ts       model registry
  proxy.ts        proxy pool, rotation and retries
providers/
  types.ts        shared provider interfaces
  gemini/         Gemini client and citation filter
  gpt/            GPT client
public/
  cmd.png         screenshot used above
```

Adding a model means implementing the `ChatProvider` interface from
[providers/types.ts](providers/types.ts) and registering it in
[src/models.ts](src/models.ts).

## Development

Run a type check without emitting files:

```bash
npx tsc --noEmit -p tsconfig.json
```

The app runs straight from source through `tsx`, so there is nothing to build.

## Getting help

- Open an issue at [github.com/coders908/ReverAPI/issues](https://github.com/coders908/ReverAPI/issues)
- Review a command's live details with `/info` inside the console

## Engineering notes

Things this project had to get right, and where to look for them:

- **Framing an undocumented request.** One service takes a deeply nested,
  positional array where a missing `null` or a shifted index changes the meaning
  of every field after it, and the other takes a keyed body with its own
  envelope and turn metadata. Both serializers are written as explicit builders
  so the shape stays readable instead of collapsing into one long literal. See
  [providers/gemini/gemini.ts](providers/gemini/gemini.ts) and
  [providers/gpt/gpt.ts](providers/gpt/gpt.ts).
- **Parsing a stream you do not control.** A delta can be split across two
  network reads, so a frame is never parsed from a single chunk. Gemini sends
  escaped JSON inside JSON behind a prefix, GPT sends newline delimited events
  with a JSON payload per event, and each parser only reads the accumulated
  buffer and emits the difference against what was already shown.
- **Filtering without breaking a stream.** Citation links have to be removed
  while text is still arriving, which means holding back anything that could
  still turn into a link and resolving it once it completes or is discarded.
  See `createCitationFilter` in [providers/gemini/gemini.ts](providers/gemini/gemini.ts).
- **Failure handling.** A proxy that accepts a connection and then stalls has to
  be distinguishable from a real answer. Requests rotate across the pool and
  retry only on status codes and error classes that are worth retrying. See
  [src/proxy.ts](src/proxy.ts).
- **Terminal layout.** Output is measured in visible columns, not string length,
  because colour codes take no room. Every rule, table and box derives its width
  from the current window, so the same code renders correctly from a narrow
  split pane to a wide screen. See [src/index.ts](src/index.ts).

## Scope

This is a personal, non commercial project built to understand how these
protocols work. It is not affiliated with Google or OpenAI, it is not a
supported client, and it carries no guarantee of continued compatibility: an
upstream protocol change can break a provider at any time.

If you need reliability, contractual quotas or support, use the official APIs.

## Disclaimer

ReverAPI is published for educational and learning purposes only. It exists to
show how a streaming chat client, a provider abstraction and a rotating proxy
pool fit together in a small TypeScript codebase.

Do not use this project for abuse, for bypassing the terms of service of any
upstream service, for automation that overloads those services, or for any
commercial use of the models it can reach. You are responsible for how you run
it and for the content you send through it.

## License

Released under the Apache License 2.0. See [LICENSE](LICENSE).

Built with ❤️ by **[@coders908](https://github.com/coders908)**
