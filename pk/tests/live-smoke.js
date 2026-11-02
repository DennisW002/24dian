const { WebSocket } = require('ws');
const assert = require('node:assert/strict');
const base = process.argv[2];
if (!base) throw Error('Usage: node pk/tests/live-smoke.js https://host.example');
const url = new URL(base);
url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
url.pathname = '/ws';
function wait(ws, predicate) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { ws.off('message', onMessage); reject(Error('Timed out waiting for room state')); }, 15000);
    function onMessage(data) { const msg = JSON.parse(data); if (predicate(msg)) { clearTimeout(timer); ws.off('message', onMessage); resolve(msg); } }
    ws.on('message', onMessage);
  });
}
function send(ws, data) { ws.send(JSON.stringify(data)); }
async function main() {
  const host = new WebSocket(url), guest = new WebSocket(url);
  try {
    await Promise.all([new Promise((r,j)=>{host.once('open',r);host.once('error',j);}),new Promise((r,j)=>{guest.once('open',r);guest.once('error',j);})]);
    const joined = wait(host,m=>m.type==='joined');
    send(host,{type:'create',name:'测试发起者',avatar:0});
    const room=(await joined).room;
    const paired=wait(host,m=>m.type==='state'&&m.players.length===2);
    const guestJoined=wait(guest,m=>m.type==='joined');
    send(guest,{type:'join',room,name:'测试朋友',avatar:15});
    await Promise.all([paired,guestJoined]);
    const ready=wait(host,m=>m.type==='state'&&m.players.every(p=>p.ready));
    send(host,{type:'ready',ready:true});
    send(guest,{type:'ready',ready:true});
    await ready;
    const started=wait(guest,m=>m.type==='state'&&m.phase==='playing');
    send(host,{type:'start'});
    const state=await started;
    assert.equal(state.players.length,2);
    assert.equal(state.players[0].level,1);
    assert.equal(state.numbers.length,4);
    console.log(`Live pairing, readiness and start: OK (${room})`);
  } finally { host.terminate(); guest.terminate(); }
}
main().catch(e=>{ console.error(e); process.exitCode=1; });

