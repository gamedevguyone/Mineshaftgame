const http = require('http'), fs = require('fs'), path = require('path'), zlib = require('zlib');
const { WebSocketServer } = require('ws');
const PORT = process.env.PORT || 3000;
const DATA = process.env.DATA_DIR || path.join(__dirname, 'data');
const FILE = path.join(DATA, 'world.json');
const CH = 80, MAXID = 45, DMG = 3;
try { fs.mkdirSync(DATA, { recursive: true }); } catch (e) { console.error('data dir:', e.message); }
let world = { seed: Math.floor(Math.random() * 1e9), edits: {} };
try { const w = JSON.parse(fs.readFileSync(FILE, 'utf8')); if (w && Number.isInteger(w.seed) && w.edits) world = w; } catch {}
let dirty = false;
const save = () => { if (!dirty) return; try { fs.writeFileSync(FILE + '.tmp', JSON.stringify(world)); fs.renameSync(FILE + '.tmp', FILE); dirty = false; } catch (e) { console.error('save:', e.message); } };
setInterval(save, 5000);
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => { save(); process.exit(0); });
process.on('uncaughtException', e => console.error('uncaught:', e));
process.on('unhandledRejection', e => console.error('unhandled:', e));

// ---------- static files (gzip cached) ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css' };
const PUB = path.join(__dirname, 'public');
const cache = new Map();
function load(p) {
  let e = cache.get(p); if (e) return e;
  const buf = fs.readFileSync(p); e = { buf, gz: zlib.gzipSync(buf, { level: 9 }), type: MIME[path.extname(p)] || 'application/octet-stream' };
  cache.set(p, e); return e;
}
const server = http.createServer((req, res) => {
  try {
    let p = decodeURIComponent((req.url || '/').split('?')[0]), f;
    if (p === '/') p = '/index.html';
    f = path.join(PUB, path.normalize(p)); if (!f.startsWith(PUB)) f = null;
    if (!f || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('Not found'); }
    const e = load(f), gz = /\bgzip\b/.test(req.headers['accept-encoding'] || '');
    res.writeHead(200, { 'Content-Type': e.type, 'Cache-Control': 'no-cache', ...(gz ? { 'Content-Encoding': 'gzip' } : {}) });
    res.end(gz ? e.gz : e.buf);
  } catch (e) { try { res.writeHead(500); res.end('Error'); } catch {} }
});
server.on('clientError', (e, s) => { try { s.end('HTTP/1.1 400 Bad Request\r\n\r\n'); } catch {} });

// ---------- game sockets ----------
const wss = new WebSocketServer({ server, maxPayload: 4096, perMessageDeflate: false });
wss.on('error', e => console.error('wss:', e.message));
const players = new Map();
let nextId = 1;
const send = (ws, o) => { try { if (ws.readyState === 1) ws.send(JSON.stringify(o)); } catch {} };
const broadcast = (o, except) => { const s = JSON.stringify(o); for (const ws of players.keys()) { if (ws === except || ws.readyState !== 1) continue; try { ws.send(s); } catch {} } };
const byId = id => { for (const p of players.values()) if (p.id === id && p.name) return p; return null; };
function hurt(p, dmg, by) {
  p.hp -= dmg; p.lastDmg = Date.now();
  if (p.hp <= 0) {
    p.hp = 20;
    broadcast({ t: 'dead', id: p.id, by: by ? by.id : 0, name: p.name, byName: by ? by.name : 'gravity' });
    send(p.ws, { t: 'respawn' }); if (by) send(by.ws, { t: 'kill' });
  }
  broadcast({ t: 'hp', id: p.id, hp: p.hp });
}
setInterval(() => { const now = Date.now(); for (const p of players.values()) if (p.name && p.hp < 20 && now - p.lastDmg > 5000) { p.hp++; broadcast({ t: 'hp', id: p.id, hp: p.hp }); } }, 4000);
setInterval(() => { for (const ws of players.keys()) { if (ws.isAlive === false) { try { ws.terminate(); } catch {} continue; } ws.isAlive = false; try { ws.ping(); } catch {} } }, 25000);

wss.on('connection', ws => {
  const me = { ws, id: nextId++, name: null, x: 0, y: 80, z: 0, ry: 0, n: 0, hp: 20, lastHit: 0, lastDmg: 0, lastPos: 0, lastFall: 0 };
  players.set(ws, me); ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('error', () => {});
  const tick = setInterval(() => { me.n = 0; }, 1000);
  ws.on('message', raw => {
    try {
      ws.isAlive = true;
      if (++me.n > 400) return;
      const m = JSON.parse(raw);
      if (!m || typeof m !== 'object') return;
      if (m.t === 'ping') return send(ws, { t: 'pong' });
      if (m.t === 'join') {
        if (me.name) return;
        me.name = String(m.name || '').replace(/[^\w .\-]/g, '').trim().slice(0, 16) || 'Player';
        send(ws, { t: 'init', id: me.id, seed: world.seed, hp: me.hp, players: [...players.values()].filter(p => p.name && p !== me).map(({ id, name, x, y, z, ry, hp }) => ({ id, name, x, y, z, ry, hp })) });
        broadcast({ t: 'join', id: me.id, name: me.name }, ws);
        return;
      }
      if (!me.name) return;
      const now = Date.now();
      if (m.t === 'pos') {
        if (now - me.lastPos < 40 || ![m.x, m.y, m.z, m.ry].every(Number.isFinite) || Math.abs(m.x) > 1e6 || Math.abs(m.z) > 1e6) return;
        me.lastPos = now; me.x = m.x; me.y = m.y; me.z = m.z; me.ry = m.ry;
        broadcast({ t: 'pos', id: me.id, x: m.x, y: m.y, z: m.z, ry: m.ry }, ws);
      } else if (m.t === 'swing') broadcast({ t: 'swing', id: me.id }, ws);
      else if (m.t === 'hit') {
        if (now - me.lastHit < 280) return; me.lastHit = now;
        const tp = byId(m.id);
        if (!tp || tp === me || Math.hypot(tp.x - me.x, tp.y - me.y, tp.z - me.z) > 6.5) return;
        const dx = tp.x - me.x, dz = tp.z - me.z, l = Math.hypot(dx, dz) || 1;
        send(tp.ws, { t: 'kb', x: dx / l, z: dz / l });
        hurt(tp, DMG, me);
      } else if (m.t === 'fall') {
        const d = Math.min(10, Math.max(1, m.d | 0)); if (now - me.lastFall < 300) return; me.lastFall = now; hurt(me, d, null);
      } else if (m.t === 'chunk' && Number.isInteger(m.cx) && Number.isInteger(m.cz)) {
        const e = world.edits[m.cx + ',' + m.cz], out = [];
        if (e) for (const k in e) { const [x, y, z] = k.split(',').map(Number); out.push([x, y, z, e[k]]); }
        send(ws, { t: 'chunk', cx: m.cx, cz: m.cz, e: out });
      } else if (m.t === 'set') {
        const { x, y, z, id } = m;
        if (![x, y, z, id].every(Number.isInteger) || y < 1 || y >= CH || id < 0 || id > MAXID) return;
        if (Math.hypot(x - me.x, y - me.y, z - me.z) > 16) return;
        const k = (x >> 4) + ',' + (z >> 4);
        (world.edits[k] ||= {})[x + ',' + y + ',' + z] = id; dirty = true;
        broadcast({ t: 'set', x, y, z, id }, ws);
      }
    } catch (e) { /* ignore malformed message */ }
  });
  ws.on('close', () => { clearInterval(tick); players.delete(ws); if (me.name) broadcast({ t: 'leave', id: me.id }); });
});
server.listen(PORT, '0.0.0.0', () => console.log('Mineshaft on port ' + PORT));
