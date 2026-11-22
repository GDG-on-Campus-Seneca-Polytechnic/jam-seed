// Phone side: send an idea, render the spec as it streams back, pin it to the wall.

const el = (id) => document.getElementById(id);
const code = (new URLSearchParams(location.search).get("code") || "").toUpperCase();

const SEEDS = [
  "something that uses the campus map",
  "a thing that listens to me and replies out loud",
  "a tool that makes my group chat less chaotic",
  "anything, surprise me — I just want to build something today",
];

let lastSpec = null;
let pinned = false;

if (/^[A-Z0-9]{4}$/.test(code)) {
  el("room").textContent = code;
  el("room").classList.remove("hidden");
}

// Warn early if the server has no key, so nobody discovers it mid-demo.
fetch("/api/health")
  .then((r) => r.json())
  .then((h) => {
    if (!h.key) {
      el("keynote").classList.remove("hidden");
      el("keymsg").textContent =
        " Get a free one at aistudio.google.com/apikey, put it in .dev.vars as GEMINI_API_KEY, and restart.";
    } else if (h.modelOk === false) {
      el("keynote").classList.remove("hidden");
      el("keynote").textContent =
        `The key works, but the model "${h.model}" did not resolve (${h.status}). ` +
        `Change GEMINI_MODEL in wrangler.jsonc to a model your key can reach.`;
    }
  })
  .catch(() => {});

el("idea").addEventListener("input", (e) => {
  el("count").textContent = e.target.value.length;
});

[...el("examples").children].forEach((b, i) => {
  b.addEventListener("click", () => {
    el("idea").value = SEEDS[i];
    el("count").textContent = SEEDS[i].length;
    el("idea").focus();
  });
});

el("go").addEventListener("click", run);
el("again").addEventListener("click", () => {
  show("ask");
  el("go").disabled = false;
});
el("copy").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(el("s-prompt").textContent);
    el("copy").textContent = "Copied";
    setTimeout(() => (el("copy").textContent = "Copy prompt"), 1500);
  } catch {
    el("copy").textContent = "Select it and copy";
  }
});
el("pin").addEventListener("click", pin);

function show(step) {
  for (const id of ["ask", "working", "result"]) {
    el(id).classList.toggle("hidden", id !== step);
  }
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  window.scrollTo({ top: 0, behavior: still ? "auto" : "smooth" });
}

function fail(message) {
  el("result").classList.remove("streaming");
  el("keynote").classList.remove("hidden");
  el("keynote").textContent = `That did not work. ${message}`;
  show("ask");
  el("go").disabled = false;
}

async function run() {
  const idea = el("idea").value.trim();
  if (idea.length < 8) {
    el("idea").focus();
    return;
  }

  el("go").disabled = true;
  el("keynote").classList.add("hidden");
  pinned = false;
  lastSpec = null; // never pin the previous spec while a new one streams
  el("result").classList.add("streaming");
  el("pin").textContent = "Pin to the wall";
  el("pin").disabled = false;
  el("pin").classList.toggle("hidden", !/^[A-Z0-9]{4}$/.test(code));
  show("working");

  let response;
  try {
    response = await fetch("/api/spec", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idea }),
    });
  } catch (err) {
    return fail("The server did not answer. Check the wifi and try again.");
  }

  if (!response.ok || !response.body) {
    const body = await response.json().catch(() => ({}));
    return fail(body.message || body.error || `Server said ${response.status}.`);
  }

  show("result");
  let text = "";
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";

  // Venue wifi drops mid-stream. Do not let that escape as an uncaught throw.
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
        if (!payload) continue;
        try {
          const chunk = JSON.parse(payload);
          // Only string frames are spec text; done and fail frames are objects.
          if (typeof chunk === "string") {
            text += chunk;
            render(parse(text));
          }
        } catch {
          /* a partial frame, the next chunk completes it */
        }
      }
    }
  } catch {
    if (!parse(text).title) {
      return fail("Lost the connection mid-stream. Try again.");
    }
  }

  lastSpec = parse(text);
  render(lastSpec);
  el("result").classList.remove("streaming");
  el("go").disabled = false;
  if (!lastSpec.title) fail("Gemini answered, but not in a shape we could read. Try again.");
}

// The model answers in flat labelled sections. Parse whatever has arrived so far.
function parse(text) {
  const spec = { title: "", pitch: "", build: [], skip: [], stack: [], milestones: [], prompt: "" };
  const lines = text.split("\n");
  let section = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    const labelled = /^(TITLE|PITCH):\s*(.*)$/i.exec(line);
    if (labelled) {
      spec[labelled[1].toLowerCase()] = labelled[2];
      section = null;
      continue;
    }
    const heading = /^(BUILD|SKIP|STACK|MILESTONES|PROMPT)\s*:?$/i.exec(line);
    if (heading) {
      section = heading[1].toLowerCase();
      continue;
    }
    if (!section) continue;

    if (section === "prompt") {
      spec.prompt += (spec.prompt ? "\n" : "") + line;
    } else {
      spec[section].push(line.replace(/^[-*•]\s*/, ""));
    }
  }
  return spec;
}

function render(spec) {
  el("s-title").textContent = spec.title || "…";
  el("s-pitch").textContent = spec.pitch;
  fill("s-build", spec.build);
  fill("s-skip", spec.skip);
  fill("s-stack", spec.stack);
  fill("s-milestones", spec.milestones, true);
  el("s-prompt").textContent = spec.prompt;

  for (const [id, list] of [
    ["sec-build", spec.build],
    ["sec-skip", spec.skip],
    ["sec-stack", spec.stack],
    ["sec-milestones", spec.milestones],
  ]) {
    el(id).classList.toggle("hidden", list.length === 0);
  }
}

function fill(id, items, timed = false) {
  const ul = el(id);
  ul.innerHTML = "";
  for (const item of items) {
    const li = document.createElement("li");
    // Milestones start with a time range ("0:25-0:60 ..."); set it apart so the plan reads as a clock.
    const at = timed && /^(\d:\d\d\s*[-–]\s*\d:\d\d)\s*[:–-]?\s*(.*)$/.exec(item);
    if (at) {
      const time = document.createElement("span");
      time.className = "time";
      time.textContent = at[1].replace(/\s*[-–]\s*/, "–");
      li.append(time, document.createTextNode(at[2]));
    } else {
      li.textContent = item;
    }
    ul.appendChild(li);
  }
}

async function pin() {
  if (!lastSpec || !lastSpec.title || pinned) return;
  el("pin").disabled = true;
  try {
    const r = await fetch(`/api/card?code=${code}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: el("name").value.trim() || "Anonymous",
        title: lastSpec.title,
        pitch: lastSpec.pitch,
        idea: el("idea").value.trim(),
      }),
    });
    if (!r.ok) throw new Error(String(r.status));
    pinned = true;
    el("pin").textContent = "On the wall ✓";
  } catch {
    el("pin").textContent = "Could not pin — retry";
    el("pin").disabled = false;
  }
}
