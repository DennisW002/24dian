const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { WebSocketServer, WebSocket } = require('ws');

const PORT = Number(process.env.PORT || 3000);
const LIMIT = 300_000;
const TOTAL = 5;
const rooms = new Map();
const publicDir = path.join(__dirname, 'public');
const puzzles = [
  [{ n: [4, 6, 7, 7], solution: '4 + 6 + 7 + 7' }, { n: [6, 6, 6, 6], solution: '6 + 6 + 6 + 6' }],
  [{ n: [5, 5, 7, 7], solution: '5 + 5 + 7 + 7' }, { n: [3, 5, 7, 9], solution: '3 + 5 + 7 + 9' }],
  [{ n: [1, 3, 8, 8], solution: '8 × (3 + 1) − 8' }, { n: [2, 4, 6, 8], solution: '8 × 4 − 6 − 2' }],
  [{ n: [1, 1, 3, 8], solution: '8 × 3 × 1 × 1' }, { n: [2, 3, 4, 6], solution: '6 × 4 × (3 − 2)' }],
  [{ n: [1, 1, 4, 6], solution: '6 × 4 × 1 × 1' }, { n: [3, 3, 8, 8], solution: '8 ÷ (3 − 8 ÷ 3)' }]
];

function send(ws, data) { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data)); }
function error(ws, message) { send(ws, { type: 'error', message }); }
function playerView(p, now) {
  return { id: p.id, name: p.name, avatar: p.avatar, ready: p.ready,
    online: p.ws?.readyState === WebSocket.OPEN, level: p.level, score: p.score,
    done: p.done, elapsedMs: p.elapsedMs + (p.startedAt ? Math.min(LIMIT, now - p.startedAt) : 0) };
}
function snapshot(room, viewer) {
  const now = Date.now();
  const p = room.players.find(x => x.id === viewer);
  return { type: 'state', room: room.id, phase: room.phase, host: room.host,
    you: viewer, players: room.players.map(x => playerView(x, now)),
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
      room = { id, host: null, phase: 'lobby', players: [], puzzles: puzzles.map(group => group[Math.floor(Math.random() * group.length)]) };
      rooms.set(id, room);
    } else {
      room = rooms.get(String(msg.room || '').toLowerCase());
      if (!room) return error(ws, '房间不存在或已过期');
      if (room.phase !== 'lobby') return error(ws, '对战已经开始');
      if (room.players.length >= 2) return error(ws, '房间已满');
    }
    const id = crypto.randomBytes(16).toString('hex');
    const p = { id, name, avatar, ws, ready: false, level: 1, score: 0, done: false, elapsedMs: 0, startedAt: 0, result: null };
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
    p.ws?.close(); p.ws = ws; ws.room = room.id; ws.player = p.id;
    broadcast(room); return;
  }
  const room = rooms.get(ws.room), p = room?.players.find(x => x.id === ws.player);
  if (!p || p.ws !== ws) return error(ws, '请先进入房间');
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
  const file = files[url.pathname];
  if (!file) { res.writeHead(404); return res.end('Not found'); }
  const type = file.endsWith('.js') ? 'application/javascript; charset=utf-8' : file.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/html; charset=utf-8';
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
module.exports = { server, wss, rooms, tick, calculate, LIMIT };

