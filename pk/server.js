const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { WebSocketServer, WebSocket } = require('ws');

const PORT = Number(process.env.PORT || 3000);
const LIMIT = 300_000;
const TOTAL = 10;
const INTERFERENCE_LIMIT = 10;
const INTERFERENCE_COOLDOWN = 2_000;
const EFFECTS = new Set(['pig', 'sparkle', 'wink', 'candy', 'flower', 'butterfly', 'balloon', 'heart', 'duck', 'cloud']);
const rooms = new Map();
const publicDir = path.join(__dirname, 'public');
const ranked = require('./ranked.json');

function solve(numbers) {
  function search(items) {
    if (items.length === 1) return items[0].f.n === 24 && items[0].f.d === 1 ? items[0].text : null;
    for (let i = 0; i < items.length; i++) for (let j = 0; j < items.length; j++) {
      if (i === j) continue;
      const a = items[i], b = items[j], rest = items.filter((_, k) => k !== i && k !== j);
      const candidates = [];
      if (i < j) {
        candidates.push({ f: F(a.f.n*b.f.d+b.f.n*a.f.d,a.f.d*b.f.d), text: `(${a.text} + ${b.text})` });
        candidates.push({ f: F(a.f.n*b.f.n,a.f.d*b.f.d), text: `(${a.text} × ${b.text})` });
      }
      candidates.push({ f: F(a.f.n*b.f.d-b.f.n*a.f.d,a.f.d*b.f.d), text: `(${a.text} − ${b.text})` });
      if (b.f.n) candidates.push({ f: F(a.f.n*b.f.d,a.f.d*b.f.n), text: `(${a.text} ÷ ${b.text})` });
      for (const c of candidates) { const answer = search([...rest,c]); if (answer) return answer; }
    }
    return null;
  }
  const answer = search(numbers.map(n => ({f:F(n),text:String(n)})));
  if (!answer) throw Error(`Unsolvable puzzle: ${numbers.join(',')}`);
  return answer.slice(1,-1);
}
function choosePuzzles() {
  return Array.from({length:TOTAL},(_,tier) => {
    const lo = Math.floor(tier * ranked.length / TOTAL), hi = Math.floor((tier + 1) * ranked.length / TOTAL);
    const key = ranked[lo + Math.floor(Math.random() * (hi - lo))];
    const n = key.split('').map(Number);
    for (let i=n.length-1;i>0;i--) { const j=Math.floor(Math.random()*(i+1)); [n[i],n[j]]=[n[j],n[i]]; }
    return { n, solution:solve(n), tier:tier+1, key };
  });
}

function send(ws, data) { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data)); }
function error(ws, message) { send(ws, { type: 'error', message }); }
function playerView(p, now) {
  return { id: p.id, name: p.name, avatar: p.avatar, ready: p.ready,
    online: p.ws?.readyState === WebSocket.OPEN, level: p.level, score: p.score,
    done: p.done, elapsedMs: p.elapsedMs + (p.startedAt ? Math.min(LIMIT, now - p.startedAt) : 0) };
}
function winnerId(players) {
  if (players.length !== 2) return null;
  if (players[0].score !== players[1].score) return players[0].score > players[1].score ? players[0].id : players[1].id;
  if (players[0].elapsedMs !== players[1].elapsedMs) return players[0].elapsedMs < players[1].elapsedMs ? players[0].id : players[1].id;
  return null;
}
function snapshot(room, viewer) {
  const now = Date.now();
  const p = room.players.find(x => x.id === viewer);
  return { type: 'state', room: room.id, phase: room.phase, host: room.host, total: TOTAL,
    winner: room.phase === 'finished' ? winnerId(room.players) : null,
    you: viewer, players: room.players.map(x => playerView(x, now)),
    interference: { used: p.interferenceUsed, limit: INTERFERENCE_LIMIT, cooldownMs: Math.max(0, p.interferenceAt - now) },
    numbers: room.phase === 'playing' && !p.done ? room.puzzles[p.level - 1].n : null,
    remainingMs: p.startedAt ? Math.max(0, LIMIT - (now - p.startedAt)) : 0,
    result: p.result || null };
}
function broadcast(room) { for (const p of room.players) send(p.ws, snapshot(room, p.id)); }
function finishRound(room, p, kind) {
  if (p.result || p.done || room.phase !== 'playing') return;
  const now = Date.now();
  p.elapsedMs += Math.min(LIMIT, now - p.startedAt);
  p.startedAt = 0;
  if (kind === 'correct') p.score++;
  p.result = { kind, solution: kind === 'timeout' ? room.puzzles[p.level - 1].solution : null };
  broadcast(room);
}
function advance(room, p) {
  if (!p.result) return;
  p.result = null;
  if (p.level === TOTAL) p.done = true;
  else { p.level++; p.startedAt = Date.now(); }
  if (room.players.every(x => x.done)) room.phase = 'finished';
  broadcast(room);
}
function F(n, d = 1) {
  if (d === 0) throw Error('不能除以 0');
  if (d < 0) { n = -n; d = -d; }
  let a = Math.abs(n), b = d;
  while (b) [a, b] = [b, a % b];
  return { n: n / (a || 1), d: d / (a || 1) };
}
function calculate(tokens, numbers) {
  if (!Array.isArray(tokens) || tokens.length > 32) throw Error('算式格式有误');
  const used = tokens.filter(t => t && t.t === 'n').map(t => t.i);
  if (used.length !== 4 || new Set(used).size !== 4 || used.some(i => !Number.isInteger(i) || i < 0 || i > 3)) throw Error('四个数字都要用上，每个只用一次');
  let pos = 0;
  const peek = () => tokens[pos];
  function expr() { let v = term(); while (peek()?.t === 'o' && ['+', '-'].includes(peek().v)) { const op = tokens[pos++].v, r = term(); v = op === '+' ? F(v.n * r.d + r.n * v.d, v.d * r.d) : F(v.n * r.d - r.n * v.d, v.d * r.d); } return v; }
  function term() { let v = factor(); while (peek()?.t === 'o' && ['*', '/'].includes(peek().v)) { const op = tokens[pos++].v, r = factor(); v = op === '*' ? F(v.n * r.n, v.d * r.d) : F(v.n * r.d, v.d * r.n); } return v; }
  function factor() { const t = tokens[pos++]; if (!t) throw Error('算式不完整'); if (t.t === 'n') return F(numbers[t.i]); if (t.t === 'o' && t.v === '(') { const v = expr(); if (tokens[pos++]?.v !== ')') throw Error('括号不匹配'); return v; } throw Error('算式格式有误'); }
  const value = expr();
  if (pos !== tokens.length) throw Error('算式格式有误');
  return value.n === 24 && value.d === 1;
}
function handle(ws, msg) {
  if (!msg || typeof msg !== 'object') return;
  if (msg.type === 'ping') return;
  if (msg.type === 'create' || msg.type === 'join') {
    const name = String(msg.name || '').trim().slice(0, 16);
    const avatar = Number(msg.avatar);
    if (!name || !Number.isInteger(avatar) || avatar < 0 || avatar >= 20) return error(ws, '请输入名字并选择头像');
    let room;
    if (msg.type === 'create') {
      const id = crypto.randomBytes(5).toString('hex');
      room = { id, host: null, phase: 'lobby', players: [], puzzles: choosePuzzles() };
      rooms.set(id, room);
    } else {
      room = rooms.get(String(msg.room || '').toLowerCase());
      if (!room) return error(ws, '房间不存在或已过期');
      if (room.phase !== 'lobby') return error(ws, '对战已经开始');
      if (room.players.length >= 2) return error(ws, '房间已满');
    }
    const id = crypto.randomBytes(16).toString('hex');
    const p = { id, name, avatar, ws, ready: false, level: 1, score: 0, done: false, elapsedMs: 0, startedAt: 0, result: null, interferenceUsed: 0, interferenceAt: 0 };
    room.players.push(p);
    if (!room.host) room.host = id;
    ws.room = room.id; ws.player = id;
    send(ws, { type: 'joined', room: room.id, token: id });
    broadcast(room); return;
  }
  if (msg.type === 'reconnect') {
    const room = rooms.get(String(msg.room || '').toLowerCase());
    const p = room?.players.find(x => x.id === msg.token);
    if (!p) return error(ws, '对战已过期，请创建新房间');
    if(p.ws && p.ws !== ws) p.ws.close(4001, 'Session opened elsewhere');
    p.ws = ws; ws.room = room.id; ws.player = p.id;
    broadcast(room); return;
  }
  const room = rooms.get(ws.room), p = room?.players.find(x => x.id === ws.player);
  if (!p || p.ws !== ws) return error(ws, '请先进入房间');
  if (msg.type === 'leave') {
    rooms.delete(room.id);
    for (const player of room.players) {
      if (player.ws) {
        player.ws.room = null;
        player.ws.player = null;
        send(player.ws, { type: player.id === p.id ? 'left' : 'room_closed' });
      }
    }
    return;
  }
  if (msg.type === 'interfere') {
    const other = room.players.find(x => x.id !== p.id);
    if (room.phase !== 'playing' || !p.done || !other || other.done) return error(ws, '只有先完成的玩家可向仍在作答的对手发送干扰');
    if (!EFFECTS.has(msg.effect)) return error(ws, '不支持这种干扰');
    if (p.interferenceUsed >= INTERFERENCE_LIMIT) return error(ws, '本场干扰次数已用完');
    if (Date.now() < p.interferenceAt) return error(ws, '请稍等片刻再发送干扰');
    if (other.ws?.readyState !== WebSocket.OPEN) return error(ws, '对手暂时离线');
    p.interferenceUsed++;
    p.interferenceAt = Date.now() + INTERFERENCE_COOLDOWN;
    send(other.ws, { type: 'interference', effect: msg.effect, from: p.name });
    broadcast(room);
    return;
  }
  if (msg.type === 'ready' && room.phase === 'lobby') { p.ready = !!msg.ready; broadcast(room); }
  else if (msg.type === 'start' && room.phase === 'lobby') {
    if (p.id !== room.host || room.players.length !== 2 || room.players.some(x => !x.ready)) return error(ws, '需要双方准备后由发起者开始');
    room.phase = 'playing'; for (const x of room.players) x.startedAt = Date.now(); broadcast(room);
  } else if (room.phase === 'playing' && !p.done) {
    if (p.startedAt && Date.now() - p.startedAt >= LIMIT) { finishRound(room, p, 'timeout'); return; }
    if (msg.type === 'submit' && !p.result) {
      try { if (calculate(msg.tokens, room.puzzles[p.level - 1].n)) finishRound(room, p, 'correct'); else send(ws, { type: 'wrong', message: '答案不等于 24，可以继续作答' }); }
      catch (e) { error(ws, e.message); }
    } else if (msg.type === 'skip' && !p.result) finishRound(room, p, 'skip');
    else if (msg.type === 'giveup' && !p.result) { finishRound(room, p, 'wrong'); advance(room, p); }
    else if (msg.type === 'next') advance(room, p);
  }
}
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/health') { res.writeHead(200); return res.end('ok'); }
  const files = { '/': 'index.html', '/app.js': 'app.js', '/style.css': 'style.css' };
  const avatar = /^\/avatars\/([0-9a-f-]+\.svg)$/.exec(url.pathname);
  const file = avatar ? `avatars/${avatar[1]}` : files[url.pathname];
  if (!file) { res.writeHead(404); return res.end('Not found'); }
  if (!fs.existsSync(path.join(publicDir,file))) { res.writeHead(404); return res.end('Not found'); }
  const type = file.endsWith('.js') ? 'application/javascript; charset=utf-8' : file.endsWith('.css') ? 'text/css; charset=utf-8' : file.endsWith('.svg') ? 'image/svg+xml' : 'text/html; charset=utf-8';
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
  fs.createReadStream(path.join(publicDir, file)).pipe(res);
});
const wss = new WebSocketServer({ server, path: '/ws' });
wss.on('connection', ws => {
  ws.on('message', data => { try { handle(ws, JSON.parse(data)); } catch { error(ws, '请求格式有误'); } });
  ws.on('close', () => { const room = rooms.get(ws.room), p = room?.players.find(x => x.id === ws.player); if (p?.ws === ws) { p.ws = null; broadcast(room); } });
});
const tick = setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    if (room.phase === 'playing') for (const p of room.players) if (p.startedAt && now - p.startedAt >= LIMIT) finishRound(room, p, 'timeout');
  }
}, 250);
server.listen(PORT, () => console.log(`24dian PK listening on ${PORT}`));
module.exports = { server, wss, rooms, tick, calculate, choosePuzzles, solve, winnerId, ranked, LIMIT };
