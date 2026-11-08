"use strict";
// Shift Handover server. No npm install needed: only Node's built-in modules.
const http = require("http"), fs = require("fs"), path = require("path");
const PORT = +process.env.PORT || 3000;
const DATA = process.env.DATA_FILE || path.join(__dirname, "data", "handover.json");
const USER = process.env.HANDOVER_USER || "", PASS = process.env.HANDOVER_PASS || "";
const DAY = 86400000;

let db = { rev: 1, items: [], chat: [], team: [], ret: { P1: 365, P2: 90, P3: 30 } };
fs.mkdirSync(path.join(path.dirname(DATA), "backups"), { recursive: true });
try { db = Object.assign(db, JSON.parse(fs.readFileSync(DATA, "utf8"))); } catch (e) {}

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const s = (v, n) => String(v == null ? "" : v).trim().slice(0, n);

function save() { // write to a temp file first so a crash never leaves a half-written file
  db.rev++;
  const t = DATA + ".tmp";
  fs.writeFileSync(t, JSON.stringify(db));
  fs.renameSync(t, DATA);
}
function backup() { // one copy per day, keeps the last 14
  try {
    const dir = path.join(path.dirname(DATA), "backups");
    fs.writeFileSync(path.join(dir, "handover-" + new Date().toISOString().slice(0, 10) + ".json"), JSON.stringify(db));
    fs.readdirSync(dir).sort().slice(0, -14).forEach(f => fs.unlinkSync(path.join(dir, f)));
  } catch (e) { console.error("backup failed:", e.message); }
}
function purge() { // retention: P1/P2/P3 by days, chat after 24 hours
  const n = Date.now(), a = db.items.length, b = db.chat.length;
  db.items = db.items.filter(i => n - i.created < (db.ret[i.pr] || 30) * DAY);
  db.chat = db.chat.filter(m => n - m.at < DAY);
  if (db.items.length < a || db.chat.length < b) save();
}
purge(); backup();
setInterval(purge, 3600000);
setInterval(backup, 6 * 3600000);

function cleanItem(b, partial) {
  const o = {}, set = (k, v) => { if (!partial || b[k] !== undefined) o[k] = v; };
  set("tk", s(b.tk, 40).toUpperCase()); set("ti", s(b.ti, 300)); set("st", s(b.st, 30)); set("ow", s(b.ow, 40)); set("nx", s(b.nx, 600));
  if (!partial) { o.pr = ["P1", "P2", "P3"].includes(b.pr) ? b.pr : "P3"; o.created = Date.now(); o.ack = null; }
  if (partial && b.ack !== undefined) o.ack = b.ack && b.ack.by ? { by: s(b.ack.by, 40), at: Date.now() } : null;
  return o;
}
const state = () => ({ rev: db.rev, items: db.items, chat: db.chat, team: db.team, ret: db.ret });
function authed(req) {
  if (!USER) return true;
  const h = req.headers.authorization || "";
  if (!h.startsWith("Basic ")) return false;
  const [u, ...p] = Buffer.from(h.slice(6), "base64").toString().split(":");
  return u === USER && p.join(":") === PASS;
}
const readBody = req => new Promise((ok, no) => {
  let d = "";
  req.on("data", c => { d += c; if (d.length > 1e5) { req.destroy(); no(new Error("too big")); } });
  req.on("end", () => { try { ok(d ? JSON.parse(d) : {}); } catch (e) { no(e); } });
  req.on("error", no);
});

http.createServer(async (req, res) => {
  const send = (c, o) => { res.writeHead(c, { "Content-Type": "application/json", "Cache-Control": "no-store" }); res.end(JSON.stringify(o)); };
  if (!authed(req)) { res.writeHead(401, { "WWW-Authenticate": 'Basic realm="Handover"' }); return res.end("Login required"); }
  const u = new URL(req.url, "http://x"), p = u.pathname, m = req.method;
  try {
    if (!p.startsWith("/api/")) { // the web page itself
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      return res.end(fs.readFileSync(path.join(__dirname, "public", "index.html")));
    }
    if (m === "GET" && p === "/api/state") return send(200, Number(u.searchParams.get("rev")) === db.rev ? { same: true } : state());
    const seg = p.split("/").filter(Boolean), kind = seg[1], id = seg[2];
    const b = ["POST", "PATCH", "PUT"].includes(m) ? await readBody(req) : {};

    if (kind === "items") {
      if (m === "POST") { if (!s(b.ti, 1)) return send(400, { error: "issue text needed" }); if (!s(b.ow, 1)) return send(400, { error: "owner needed" }); db.items.push(Object.assign({ id: uid() }, cleanItem(b, false))); }
      else { const i = db.items.find(x => x.id === id); if (!i) return send(404, { error: "not found" });
        if (m === "PATCH") Object.assign(i, cleanItem(b, true)); else if (m === "DELETE") db.items = db.items.filter(x => x !== i); else return send(405, {}); }
    } else if (kind === "chat") {
      if (m === "POST") { if (!s(b.name, 1) || !s(b.text, 1)) return send(400, { error: "name and text needed" }); db.chat.push({ id: uid(), name: s(b.name, 40), text: s(b.text, 500), at: Date.now(), pin: false }); }
      else { const c = db.chat.find(x => x.id === id); if (!c) return send(404, { error: "not found" });
        if (m === "PATCH") c.pin = !!b.pin; else if (m === "DELETE") db.chat = db.chat.filter(x => x !== c); else return send(405, {}); }
    } else if (kind === "team" && m === "PUT") {
      const seen = new Set(); db.team = (Array.isArray(b.names) ? b.names : []).map(n => s(n, 40)).filter(n => n && !seen.has(n.toLowerCase()) && seen.add(n.toLowerCase())).slice(0, 100);
    } else if (kind === "ret" && m === "PUT") {
      ["P1", "P2", "P3"].forEach(k => { const n = parseInt(b[k], 10); if (n >= 1 && n <= 3650) db.ret[k] = n; });
      purge();
    } else return send(404, { error: "unknown route" });

    save();
    send(200, state());
  } catch (e) { send(400, { error: e.message }); }
}).listen(PORT, () => console.log("Handover running on port " + PORT + (USER ? " (login on)" : " (NO login set)")));
