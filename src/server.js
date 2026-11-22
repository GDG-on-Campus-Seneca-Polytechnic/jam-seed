// Jam Seed: turn a half-formed idea into a spec you can actually build in two hours.
// One Durable Object per jam room. Phones stream a spec from Gemini, then pin it to the wall.

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I, O, 0, 1
const MAX_CARDS = 60;
const MAX_IDEA = 400;

const SYSTEM = `You are the facilitator of a GDG on Campus Coding Jam at Seneca Polytechnic.
A student gives you a half-formed idea. You turn it into something they can genuinely finish
in a two-hour session, alone or in a pair, starting from nothing.

Rules you never break:
- Two hours is the hard limit. Cut scope until it fits. A tiny thing that runs beats a big thing that does not.
- Only free tools a student can reach today with no credit card: Google AI Studio, the Gemini API free
  tier, Antigravity, Firebase Spark, Google Colab, Google Maps embeds, GitHub Pages.
- No accounts to create beyond a Google sign-in. No paid APIs. No app-store review.
- Be concrete. Name the actual thing on the screen, not a category.
- Never invent facts about GDG @ Seneca, its members, or its events.

Answer in exactly this format, with these headings, and nothing else. No markdown, no asterisks.

TITLE: four words or fewer
PITCH: one sentence a stranger understands
BUILD
- must-have you will finish
- must-have you will finish
- must-have you will finish
SKIP
- tempting thing you are not building today
- tempting thing you are not building today
STACK
- Tool - the one job it does here
- Tool - the one job it does here
- Tool - the one job it does here
MILESTONES
- 0:00-0:25 what exists at this point
- 0:25-0:60 what exists at this point
- 1:00-1:35 what exists at this point
- 1:35-2:00 what exists at this point
PROMPT
A paste-ready prompt for Google AI Studio or Antigravity. Four to six sentences. Written as an
instruction to the AI, naming the files or screens to create. No preamble.`;

function randomCode(n = 4) {
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  return [...bytes].map((b) => CODE_CHARS[b % CODE_CHARS.length]).join("");
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function roomOf(env, code) {
  return env.JAMS.get(env.JAMS.idFromName(code));
}

function validCode(code) {
  return /^[A-Z0-9]{4}$/.test(code);
}

// Ask Gemini for a spec and relay its token stream to the browser as SSE.
async function streamSpec(idea, env) {
  const key = env.GEMINI_API_KEY;
  if (!key) {
    return json(
      {
        error: "no-key",
        message:
          "No Gemini API key on the server. Get a free one at aistudio.google.com/apikey, then put it in .dev.vars (local) or run: npx wrangler secret put GEMINI_API_KEY",
      },
      503,
    );
  }

  const model = env.GEMINI_MODEL || "gemini-3-flash-preview";
  const upstream = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`,
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM }] },
        contents: [{ role: "user", parts: [{ text: `The idea: ${idea}` }] }],
        generationConfig: { temperature: 1.0, maxOutputTokens: 1400 },
      }),
    },
  );

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => "");
    return json(
      {
        error: "gemini",
        status: upstream.status,
        message: `Gemini said ${upstream.status}. ${detail.slice(0, 300)}`,
      },
      502,
    );
  }

  // Gemini's SSE frames carry a whole candidate object; forward just the text.
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const enc = new TextEncoder();

  (async () => {
    const reader = upstream.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "";
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        let cut;
        while ((cut = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, cut).trim();
          buffer = buffer.slice(cut + 1);
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === "[DONE]") continue;
          let text = "";
          try {
            const frame = JSON.parse(payload);
            for (const part of frame?.candidates?.[0]?.content?.parts || []) {
              if (part.thought) continue; // reasoning, not the answer
              if (typeof part.text === "string") text += part.text;
            }
          } catch {
            continue; // partial frame, next chunk completes it
          }
          if (text) await writer.write(enc.encode(`data: ${JSON.stringify(text)}\n\n`));
        }
      }
      await writer.write(enc.encode("event: done\ndata: {}\n\n"));
    } catch (err) {
      // An object, not a string: the client only treats string payloads as spec text.
      await writer.write(
        enc.encode(`event: fail\ndata: ${JSON.stringify({ error: String(err) })}\n\n`),
      );
    } finally {
      await writer.close().catch(() => {});
    }
  })();

  return new Response(readable, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/new") {
      return json({ code: randomCode() });
    }

    // Is this thing actually going to work? Checks the key and that the model id resolves,
    // so a typo in GEMINI_MODEL surfaces before a room full of people is watching.
    if (url.pathname === "/api/health") {
      const model = env.GEMINI_MODEL || "gemini-3-flash-preview";
      const key = Boolean(env.GEMINI_API_KEY);
      if (!key) return json({ key, model, modelOk: null });

      const probe = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}`,
        { headers: { "x-goog-api-key": env.GEMINI_API_KEY } },
      ).catch(() => null);

      return json({
        key,
        model,
        modelOk: probe ? probe.ok : null,
        status: probe ? probe.status : null,
      });
    }

    if (url.pathname === "/api/spec" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const idea = String(body.idea || "").trim().slice(0, MAX_IDEA);
      if (idea.length < 8) return json({ error: "Tell me a bit more than that." }, 400);
      return streamSpec(idea, env);
    }

    if (url.pathname === "/api/card" || url.pathname === "/api/ws") {
      const code = (url.searchParams.get("code") || "").toUpperCase();
      if (!validCode(code)) return json({ error: "bad room code" }, 400);
      return roomOf(env, code).fetch(request);
    }

    return env.ASSETS.fetch(request);
  },
};

export class Jam {
  constructor(state) {
    this.state = state;
    this.sockets = new Set();
    this.cards = [];
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/api/card") {
      const card = await request.json().catch(() => null);
      if (!card || !card.title) return json({ error: "bad card" }, 400);
      const saved = {
        id: crypto.randomUUID(),
        name: String(card.name || "Anonymous").slice(0, 32),
        title: String(card.title).slice(0, 80),
        pitch: String(card.pitch || "").slice(0, 200),
        idea: String(card.idea || "").slice(0, MAX_IDEA),
        at: Date.now(),
      };
      this.cards.push(saved);
      if (this.cards.length > MAX_CARDS) this.cards.shift();
      this.broadcast({ type: "card", card: saved });
      return json({ ok: true, count: this.cards.length });
    }

    if (request.headers.get("upgrade") !== "websocket") {
      return new Response("expected websocket", { status: 426 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();
    this.sockets.add(server);
    server.send(JSON.stringify({ type: "hello", cards: this.cards }));
    const drop = () => this.sockets.delete(server);
    server.addEventListener("close", drop);
    server.addEventListener("error", drop);

    return new Response(null, { status: 101, webSocket: client });
  }

  broadcast(msg) {
    const text = JSON.stringify(msg);
    for (const ws of this.sockets) {
      try {
        ws.send(text);
      } catch {
        this.sockets.delete(ws);
      }
    }
  }
}
