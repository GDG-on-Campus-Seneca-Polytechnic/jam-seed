// Big screen: the QR to join and every idea as it lands.

const el = (id) => document.getElementById(id);
let count = 0;
const seen = new Set(); // a reconnect replays every card in "hello"; show each one once

start();

async function start() {
  let code = (new URLSearchParams(location.search).get("code") || "").toUpperCase();
  if (!/^[A-Z0-9]{4}$/.test(code)) {
    code = (await fetch("/api/new").then((r) => r.json())).code;
    history.replaceState(null, "", `?code=${code}`);
  }

  el("code").textContent = code;
  const joinUrl = `${location.origin}/?code=${code}`;
  el("joinurl").textContent = joinUrl.replace(/^https?:\/\//, "");

  const qr = qrcode(0, "M");
  qr.addData(joinUrl);
  qr.make();
  el("qr").innerHTML = qr.createSvgTag({ cellSize: 6, margin: 0, scalable: true });

  connect(code);
}

function connect(code) {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${location.host}/api/ws?code=${code}`);

  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data);
    if (msg.type === "hello") {
      for (const card of msg.cards) add(card, false);
    } else if (msg.type === "card") {
      add(msg.card, true);
    }
  });

  // A projector laptop sleeps, wifi drops. Just come back.
  ws.addEventListener("close", () => setTimeout(() => connect(code), 2000));
}

function add(card, fresh) {
  if (card.id) {
    if (seen.has(card.id)) return;
    seen.add(card.id);
  }
  const empty = document.querySelector(".wall .empty");
  if (empty) empty.remove();

  const tile = document.createElement("article");
  // Only cards pinned live get the entrance; a reload should not replay the whole wall.
  tile.className = fresh ? "tile fresh" : "tile";

  const h3 = document.createElement("h3");
  h3.textContent = card.title;
  const p = document.createElement("p");
  p.textContent = card.pitch;
  const by = document.createElement("div");
  by.className = "by";
  by.textContent = card.name;

  tile.append(h3, p, by);
  el("wall").prepend(tile);

  count += 1;
  el("tally").textContent = count;
  el("tally-label").textContent = count === 1 ? "idea on the wall" : "ideas on the wall";
}
