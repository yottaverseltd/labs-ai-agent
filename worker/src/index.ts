import { Hono } from "hono";

type Env = {
  ANTHROPIC_API_KEY: string;
  ANTHROPIC_MODEL?: string;
  /** Comma-separated extra allowed browser Origins for CORS (e.g. custom GitHub Pages domain). */
  ALLOWED_ORIGINS?: string;
};

/**
 * Keep in sync with DISPLAY_SYSTEM_PROMPT in client/app.js for the UI toggle.
 * Avoid em-dash (U+2014) in model-facing copy; use hyphen or colon.
 */
const SYSTEM_PROMPT = `You draft concise architecture decision records and decision memos from raw notes.

Output ONLY structured Markdown using exactly these top-level headings in this order:
## Context
## Options
## Trade-offs
## Recommendation
## Open Questions

Rules:
- Under each heading use short bullets or tight paragraphs. No filler.
- Professional tone. No emoji. No hype.
- Do not use em-dash punctuation anywhere in the document; use hyphen or colon instead.
- If information is missing, say so under Open Questions rather than inventing facts.
- Recommendation must be actionable and scoped to what the context supports.`;

function extraAllowedOrigins(env: Env): Set<string> {
  const raw = env.ALLOWED_ORIGINS ?? "";
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

function corsHeaders(origin: string | undefined, env: Env): Record<string, string> {
  const o = origin ?? "";
  const extras = extraAllowedOrigins(env);
  const allowed =
    o === "https://yottaverseltd.github.io" ||
    extras.has(o) ||
    /^http:\/\/localhost(?::\d+)?$/i.test(o);
  if (!allowed) {
    return {};
  }
  return {
    "Access-Control-Allow-Origin": o,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
}

const app = new Hono<{ Bindings: Env }>();

app.options("/v1/draft", (c) => {
  const h = corsHeaders(c.req.header("Origin"), c.env);
  if (!h["Access-Control-Allow-Origin"]) {
    return new Response(null, { status: 403 });
  }
  return new Response(null, { status: 204, headers: h });
});

app.get("/", (c) => {
  return c.json({
    service: "labs-ai-agent",
    draft: "POST /v1/draft JSON body { context: string }",
  });
});

app.post("/v1/draft", async (c) => {
  const origin = c.req.header("Origin");
  const ch = corsHeaders(origin, c.env);
  if (!ch["Access-Control-Allow-Origin"]) {
    return new Response(JSON.stringify({ error: "Origin not allowed" }), {
      status: 403,
      headers: { "content-type": "application/json", ...ch },
    });
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { "content-type": "application/json", ...ch },
    });
  }

  const ctx =
    body &&
    typeof body === "object" &&
    "context" in body &&
    typeof (body as { context: unknown }).context === "string"
      ? (body as { context: string }).context
      : "";

  if (!ctx.trim()) {
    return new Response(
      JSON.stringify({ error: "context must be a non-empty string" }),
      {
        status: 400,
        headers: { "content-type": "application/json", ...ch },
      },
    );
  }

  const apiKey = c.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "Server misconfigured" }), {
      status: 500,
      headers: { "content-type": "application/json", ...ch },
    });
  }

  const model = c.env.ANTHROPIC_MODEL ?? "claude-haiku-4-20250514";

  const upstream = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 8192,
      stream: true,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: ctx }],
        },
      ],
    }),
  });

  if (!upstream.ok || !upstream.body) {
    return new Response(
      JSON.stringify({
        error: "Upstream request failed",
        status: upstream.status,
      }),
      {
        status: 502,
        headers: { "content-type": "application/json", ...ch },
      },
    );
  }

  return new Response(upstream.body, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      ...ch,
    },
  });
});

export default app;
