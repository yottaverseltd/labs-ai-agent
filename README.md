# labs-ai-agent

Static browser client plus a Cloudflare Worker that streams Anthropic Messages output for ADR and decision memo drafting.

## What ships

- **Client (`client/`)**: `index.html` + `app.js`. Textarea, Submit, Abort, streaming Markdown preview, Download `.md`, Reset, and a toggle to show the system prompt (read-only, no API keys).
- **Worker (`worker/src/index.ts`)**: `POST /v1/draft` with JSON `{ "context": "..." }`. Response is `text/event-stream` proxied from Anthropic with streaming enabled.
- **Secrets**: `ANTHROPIC_API_KEY` via Wrangler. Optional `ANTHROPIC_MODEL` if you want Sonnet or another slug instead of the default fast Haiku model.

## Architecture (prose diagram)

Browser on GitHub Pages loads `index.html` under `/labs-ai-agent/`. The page reads `window.__WORKER_BASE__` if injected, otherwise `client/config.json`, otherwise `localStorage` key `labs_ai_worker_base`. Submit sends `POST {workerBase}/v1/draft` with JSON context. The Worker validates Origin against `https://yottaverseltd.github.io` or `http://localhost:*`, attaches the shared system prompt, calls Anthropic Messages with `stream: true`, and pipes bytes back without buffering the full completion. The browser parses SSE frames and appends text deltas into the output pane. Download wraps the accumulated Markdown as `adr-draft.md`. Abort uses `AbortController` on the fetch.

Request bodies are never logged by the Worker.

## Style constraints

- No em-dash (U+2014) in README, UI strings shown here, or the model system prompt. Prefer hyphen or colon.
- Avoid "AI-smell" filler in the system prompt: short, professional instructions only.

## Local development

```bash
cd /path/to/labs-ai-agent
npm install
npx wrangler secret put ANTHROPIC_API_KEY
# optional:
# npx wrangler secret put ANTHROPIC_MODEL
npx wrangler dev
```

Open `client/index.html` via a local static server (so `fetch('./config.json')` works), set `client/config.json` `workerBase` to `http://127.0.0.1:8787` (or your Wrangler URL), and submit. Browser Origin must be `http://localhost:<port>` for CORS.

Quick static server example:

```bash
cd client
npx --yes serve -l 5173
```

Then set `"workerBase": "http://127.0.0.1:8787"` in `config.json`.

## Deploy Worker (exact command)

From the repository root (where `wrangler.toml` lives):

```bash
npm install
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler deploy
```

Note the printed `*.workers.dev` URL (or your custom route). Put that value into `client/config.json` as `workerBase`, commit if appropriate, or configure repository variable `WORKER_PUBLIC_URL` for the Pages workflow so CI injects it.

Default model if `ANTHROPIC_MODEL` is unset: `claude-haiku-4-20250514` (small, fast). Override with `npx wrangler secret put ANTHROPIC_MODEL` using any current Messages-capable slug your org allows (for example Sonnet-class IDs documented by Anthropic).

## Deploy client (GitHub Pages)

1. Repo Settings → Pages → Source: GitHub Actions.
2. Optional: Settings → Secrets and variables → Actions → Variables → add `WORKER_PUBLIC_URL` with your Worker URL (no trailing slash). The workflow rewrites `client/config.json` and `window.__WORKER_BASE__` before upload.
3. Push to `main`; workflow `.github/workflows/pages.yml` publishes the `client/` folder.

Site URL shape: `https://yottaverseltd.github.io/labs-ai-agent/` for project Pages.

## Streaming fallback

This repo ships streaming end-to-end. If Anthropic streaming becomes incompatible with your Worker constraints, switch to a non-streaming `stream: false` implementation: collect full text server-side, return `text/plain` or JSON once, and show a loading state in the client until the response completes. Document that change in this README under this section.

## Live demo links

After both deploys complete, fill in:

- Worker: `<paste workers.dev URL>`
- Pages: `https://yottaverseltd.github.io/labs-ai-agent/`

## curl (non-browser)

`POST /v1/draft` requires an allowed `Origin` header:

```bash
curl -N -X POST "$WORKER_URL/v1/draft" \
  -H "Content-Type: application/json" \
  -H "Origin: http://localhost:5173" \
  -d '{"context":"Pick auth approach for internal API"}'
```
