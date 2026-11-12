const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const COOLDOWN = 15000;
const html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'));

const server = http.createServer((req, res) => {
  if (req.url === '/health') { res.writeHead(200); res.end('ok'); return; }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
});
const wss = new WebSocketServer({ server, maxPayload: 2 * 1024 * 1024 });

const users = new Map(); // ws -> { name, lastNudge, lastMsg }
const history = [];

function send(ws, o) { if (ws.readyState === 1) ws.send(JSON.stringify(o)); }
function all(o, except) {
  const s = JSON.stringify(o);
  for (const ws of users.keys()) if (ws !== except && ws.readyState === 1) ws.send(s);
}
function push(m) { history.push(m); if (history.length > 40) history.shift(); all(m); }
function sys(text) { push({ t: 'sys', text, ts: Date.now() }); }
function userList() { return [...users.values()].map(u => u.name); }

wss.on('connection', ws => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    const u = users.get(ws);
    const now = Date.now();

    if (m.t === 'join' && !u) {
      const name = String(m.name || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 16);
      if (!name) { send(ws, { t: 'err', msg: 'Bir kullanıcı adı yaz.' }); return; }
      for (const o of users.values()) {
        if (o.name.toLocaleLowerCase('tr') === name.toLocaleLowerCase('tr')) {
          send(ws, { t: 'err', msg: 'Bu isim odada kullanılıyor, başka bir isim seç.' }); return;
        }
      }
      users.set(ws, { name, lastNudge: 0, lastMsg: 0 });
      send(ws, { t: 'welcome', name, history });
      sys('👋 ' + name + ' odaya katıldı.');
      all({ t: 'users', list: userList() });
      return;
    }
    if (!u) return;

    if (m.t === 'msg') {
      if (now - u.lastMsg < 150) return;
      u.lastMsg = now;
      const text = String(m.text || '').slice(0, 500).trim();
      if (!text) return;
      push({ t: 'msg', name: u.name, text, ts: now });
    } else if (m.t === 'img') {
      if (now - u.lastMsg < 500) return;
      const d = String(m.data || '');
      if (!d.startsWith('data:image/jpeg;base64,') || d.length > 1500000) return;
      u.lastMsg = now;
      push({ t: 'msg', name: u.name, img: d, ts: now });
    } else if (m.t === 'nudge') {
      const left = COOLDOWN - (now - u.lastNudge);
      if (left > 0) { send(ws, { t: 'cool', ms: left }); return; }
      u.lastNudge = now;
      send(ws, { t: 'cool', ms: COOLDOWN });
      all({ t: 'nudge', name: u.name }, ws);
      sys('🚨 ' + u.name + ' ortalığı birbirine kattı! 😂🤣');
    }
  });

  ws.on('close', () => {
    const u = users.get(ws);
    if (!u) return;
    users.delete(ws);
    sys('🚪 ' + u.name + ' ayrıldı.');
    all({ t: 'users', list: userList() });
  });
});

setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false; ws.ping();
  }
}, 30000);

server.listen(PORT, () => console.log('Sohbet sunucusu calisiyor: ' + PORT));
