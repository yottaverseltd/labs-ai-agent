# labs-ai-agent

Static browser client plus a **Cloudflare Worker** that streams Anthropic Messages output for ADR and decision memo drafting.

**Pages (client):** https://yottaverseltd.github.io/labs-ai-agent/

**Source:** https://github.com/yottaverseltd/labs-ai-agent

**Worker URL:** set only after you deploy. The Worker will not answer authenticated streaming without **`ANTHROPIC_API_KEY`** in the Worker environment (Wrangler: `npx wrangler secret put ANTHROPIC_API_KEY`). Without that secret, public "Live" still loads the shell, but Submit cannot stream model output.

Optional repository variable **`WORKER_PUBLIC_URL`** (no trailing slash) lets the GitHub Actions Pages workflow rewrite `client/config.json` and `window.__WORKER_BASE__` so the hosted client points at your deployed Worker.

## What ships

- **Client (`client/`)**: `index.html` + `app.js`. Textarea, Submit, Abort, streaming Markdown preview, Download `.md`, Reset, and a toggle to show the system prompt (read-only, no API keys).
- **Worker (`worker/src/index.ts`)**: `POST /v1/draft` with JSON `{ "context": "..." }`. Response is `text/event-stream` proxied from Anthropic with streaming enabled.
- **Secrets**: `ANTHROPIC_API_KEY` via Wrangler. Optional `ANTHROPIC_MODEL` if you want another Messages-capable slug instead of the default fast Haiku model.

## Architecture (short)

Browser on GitHub Pages loads `index.html` under `/labs-ai-agent/`. The page resolves the Worker base from `window.__WORKER_BASE__`, then `client/config.json`, then `localStorage` key `labs_ai_worker_base`. Submit sends `POST {workerBase}/v1/draft` with JSON context. The Worker validates Origin against `https://yottaverseltd.github.io` or `http://localhost:*`, attaches the shared system prompt, calls Anthropic Messages with `stream: true`, and pipes bytes back. The browser parses SSE frames and appends text into the output pane.

Request bodies are not logged by the Worker.

## Style constraints

- No em-dash (U+2014) in README, UI strings shown here, or the model system prompt. Prefer hyphen or colon.
- Avoid filler in the system prompt: short, professional instructions only.

## Local development

```bash
cd /path/to/labs-ai-agent
npm install
npx wrangler secret put ANTHROPIC_API_KEY
# optional:
# npx wrangler secret put ANTHROPIC_MODEL
npx wrangler dev
```

Open `client/index.html` via a local static server so `fetch('./config.json')` works; set `client/config.json` `workerBase` to `http://127.0.0.1:8787` (or your Wrangler URL).

```bash
cd client
npx --yes serve -l 5173
```

## Deploy Worker

From the repository root (where `wrangler.toml` lives):

```bash
npm install
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler deploy
```

Note the printed `*.workers.dev` URL (or your custom route). Put that value into `client/config.json` as `workerBase`, or set **`WORKER_PUBLIC_URL`** for the Pages workflow.

Default model if `ANTHROPIC_MODEL` is unset: `claude-haiku-4-20250514`. Override with `npx wrangler secret put ANTHROPIC_MODEL` using any Messages-capable slug your org allows.

## Deploy client (GitHub Pages)

[`.github/workflows/pages.yml`](.github/workflows/pages.yml) publishes `client/` on push to `main` (split build and deploy jobs, Pages enablement in the configure step).

## Streaming fallback

This repo ships streaming end-to-end. If you ever need non-streaming behaviour, switch the Worker to `stream: false`, return one body, and show loading state in the client until the response completes; document that change here.

## curl (non-browser)

`POST /v1/draft` requires an allowed `Origin` header:

```bash
curl -N -X POST "$WORKER_URL/v1/draft" \
  -H "Content-Type: application/json" \
  -H "Origin: http://localhost:5173" \
  -d '{"context":"Pick auth approach for internal API"}'
```
