// سيرفر اللعبة الأونلاين — Node.js + WebSocket
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;

// ---------- ملفات الواجهة ----------
const server = http.createServer((req, res) => {
  let file = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  const ext = path.extname(file);
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };
  fs.readFile(path.join(__dirname, 'public', file), (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': types[ext] || 'text/plain' });
    res.end(data);
  });
});

// ---------- بيانات اللاعبين ----------
const POOL = [
  { n: "صاروخ", p: "مهاجم", a: 9, d: 3, r: "gold" },
  { n: "المايسترو", p: "وسط", a: 7, d: 6, r: "gold" },
  { n: "الصخرة", p: "مدافع", a: 3, d: 9, r: "gold" },
  { n: "البرق", p: "جناح", a: 8, d: 4, r: "silver" },
  { n: "الحارس العملاق", p: "حارس", a: 2, d: 10, r: "gold" },
  { n: "القناص", p: "مهاجم", a: 10, d: 2, r: "black" },
  { n: "الرسام", p: "وسط", a: 6, d: 6, r: "silver" },
  { n: "الجدار", p: "مدافع", a: 2, d: 8, r: "silver" },
  { n: "الوهم", p: "جناح", a: 9, d: 3, r: "gold" },
  { n: "المدمر", p: "وسط", a: 7, d: 5, r: "silver" },
  { n: "الصغير الساحر", p: "جناح", a: 9, d: 4, r: "black" },
  { n: "القائد", p: "وسط", a: 8, d: 7, r: "black" },
  { n: "الفرعون", p: "مهاجم", a: 10, d: 3, r: "black" },
  { n: "الثعلب", p: "مهاجم", a: 8, d: 3, r: "silver" },
  { n: "العميد", p: "مدافع", a: 3, d: 10, r: "black" },
  { n: "النينجا", p: "جناح", a: 8, d: 5, r: "silver" },
  { n: "المخضرم", p: "وسط", a: 6, d: 7, r: "gold" },
  { n: "شباك صغير", p: "حارس", a: 2, d: 9, r: "silver" },
];
const rand = max => Math.floor(Math.random() * max);
function randCard() {
  const x = Math.random();
  const r = x < 0.5 ? "silver" : x < 0.8 ? "gold" : "black";
  const opts = POOL.filter(c => c.r === r);
  return { id: Math.random().toString(36).slice(2, 8), ...opts[rand(opts.length)] };
}
function buildDeck() { return Array.from({ length: 5 }, randCard); }

// ---------- إدارة الغرف ----------
const rooms = {}; // code -> room
function makeCode() {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let c; do { c = Array.from({ length: 4 }, () => chars[rand(chars.length)]).join(''); } while (rooms[c]);
  return c;
}
function send(ws, msg) { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); }
function broadcast(room, msg) { room.players.forEach(p => send(p.ws, msg)); }

function startGame(room) {
  room.players.forEach(p => { p.deck = buildDeck(); p.score = 0; p.pick = null; });
  room.round = 1; room.over = false;
  room.players.forEach((p, i) => {
    send(p.ws, {
      t: 'start', code: room.code, you: i, names: room.players.map(x => x.name),
      oppDeckCount: 5, yourDeck: p.deck, round: 1
    });
  });
}

function resolveRound(room) {
  const [p1, p2] = room.players;
  const c1 = p1.deck.find(c => c.id === p1.pick);
  const c2 = p2.deck.find(c => c.id === p2.pick);
  const shot1 = c1.a + rand(5), block2 = c2.d + rand(5);
  const shot2 = c2.a + rand(5), block1 = c1.d + rand(5);
  if (shot1 > block2) p1.score++;
  if (shot2 > block1) p2.score++;
  broadcast(room, {
    t: 'round', round: room.round, cards: [c1, c2],
    rolls: { shot1, block2, shot2, block1 },
    scores: [p1.score, p2.score],
    goal1: shot1 > block2, goal2: shot2 > block1
  });
  p1.deck = p1.deck.filter(c => c.id !== p1.pick);
  p2.deck = p2.deck.filter(c => c.id !== p2.pick);
  p1.pick = p2.pick = null;
  if (p1.deck.length === 0) {
    room.over = true;
    let winner = p1.score > p2.score ? 0 : p2.score > p1.score ? 1 : -1;
    broadcast(room, { t: 'over', scores: [p1.score, p2.score], winner, names: [p1.name, p2.name] });
  } else {
    room.round++;
    broadcast(room, { t: 'next', round: room.round });
  }
}

// ---------- الاتصال ----------
const wss = new WebSocketServer({ server });
wss.on('connection', ws => {
  let me = null, room = null;
  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch { return; }

    if (m.t === 'create') {
      const code = makeCode();
      room = { code, players: [{ ws, name: (m.name || 'لاعب').slice(0, 12), deck: [], score: 0, pick: null }], round: 1, over: false };
      rooms[code] = room; me = 0;
      send(ws, { t: 'created', code });
    }
    else if (m.t === 'join') {
      const code = (m.code || '').toUpperCase().trim();
      room = rooms[code];
      if (!room) return send(ws, { t: 'error', msg: 'الكود ده مش موجود، اتأكد منه' });
      if (room.players.length >= 2) return send(ws, { t: 'error', msg: 'الغرفة مكتملة (لاعبين)' });
      room.players.push({ ws, name: (m.name || 'لاعب').slice(0, 12), deck: [], score: 0, pick: null });
      me = 1;
      startGame(room);
    }
    else if (m.t === 'pick' && room && !room.over) {
      const p = room.players[me];
      if (p.pick) return;
      p.pick = m.cardId;
      broadcast(room, { t: 'picked', by: me });
      if (room.players.every(x => x.pick)) resolveRound(room);
    }
    else if (m.t === 'rematch' && room && room.over) {
      room.players[me].rematch = true;
      if (room.players.every(x => x.rematch)) {
        room.players.forEach(x => x.rematch = false);
        startGame(room);
      }
    }
  });
  ws.on('close', () => {
    if (room && me !== null) {
      broadcast(room, { t: 'opponent_left' });
      delete rooms[room.code];
    }
  });
});

server.listen(PORT, () => console.log('⚽ اللعبة شغالة على http://localhost:' + PORT));
