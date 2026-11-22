# Jam Seed

A Coding Jam in one screen. Someone types the idea they have been sitting on; Gemini cuts it down
to something they can genuinely finish in two hours with free Google tools, and hands back the
prompt to start from. Every spec lands on a live wall behind the speaker.

Built for [codingjam.dev](https://codingjam.dev)-style sessions at GDG on Campus Seneca
Polytechnic. It is the answer to the question every jam opens with: *"but what do I build?"*

## Run it

```bash
npm install
cp .dev.vars.example .dev.vars   # then paste your key into it
npm run dev
```

Get a Gemini API key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey) — free,
no credit card. Put it in `.dev.vars` as `GEMINI_API_KEY`.

Then:

| Where | URL |
|---|---|
| Big screen | <http://localhost:8787/screen.html> |
| Phones | the QR on that screen, or `http://localhost:8787/?code=ABCD` |

Without a key the pages still load and the phone shows a plain "no key yet" card, so a broken
setup never looks like a broken demo. `/api/health` also checks that `GEMINI_MODEL` resolves, so
a wrong model id shows up as a sentence on the phone rather than a 502 in front of the room.

### Phones cannot reach `localhost`

The QR encodes whatever host the screen is open on. For a rehearsal with real phones, bind to the
LAN and open the screen at your laptop's IP:

```bash
npx wrangler dev --ip 0.0.0.0 --port 8787
```

For the real thing, deploy — `workers.dev` gives you https, which **Copy prompt** needs (the
clipboard API is blocked on plain http).

## How a session runs

1. Put `screen.html` on the projector. It generates a four-letter room code and a QR.
2. People scan, type a rough idea, and watch the spec stream in.
3. They tap **Pin to the wall** and the room fills up in front of everyone.
4. They tap **Copy prompt**, open AI Studio, and start actually building.

## Shape of it

| File | What it does |
|---|---|
| `src/server.js` | Worker: `/api/spec` streams Gemini as SSE, `Jam` Durable Object holds one room's wall |
| `public/index.html`, `app.js` | Phone: the form, the streaming spec card |
| `public/screen.html`, `screen.js` | Projector: QR, room code, live wall |
| `public/style.css` | Both |

The API key lives only in the Worker. The browser never sees it.

The model answers in flat labelled sections (`TITLE:`, `BUILD`, `SKIP`, `STACK`, `MILESTONES`,
`PROMPT`) rather than JSON, so the card can render while the tokens are still arriving. `parse()`
in `app.js` reads whatever has arrived so far.

## Deploy

```bash
npx wrangler secret put GEMINI_API_KEY
npm run deploy
```

Needs a Cloudflare account. `gemini-3-flash-preview` is the default model because it is the one
on the Gemini API free tier; change `GEMINI_MODEL` in `wrangler.jsonc` to move off it.

## Before running it in a room

- [ ] Confirm `GEMINI_MODEL` against a real key — `/api/health` tells you in one request
- [ ] Time how long the first token takes on stage; tune the model if it drags
- [ ] Rehearse on the venue wifi, not just at home
- [ ] Have one spec generated and screenshotted as a fallback if the network dies
- [ ] Check the free-tier rate limit against the number of people you expect

The wall lives in the Durable Object's memory, not its storage. Good enough for a one-hour
session; if the projector laptop reloads after the object has been evicted, the wall starts
empty. Move `this.cards` into `state.storage` if that matters.
