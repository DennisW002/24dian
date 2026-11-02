const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { WebSocket } = require('ws');
process.env.PORT = '0';
const app = require('../server');

class Client {
  constructor(ws) { this.ws = ws; this.queue = []; this.waiters = []; ws.on('message', data => { const msg = JSON.parse(data); const i = this.waiters.findIndex(w => w.predicate(msg)); if (i >= 0) this.waiters.splice(i,1)[0].resolve(msg); else this.queue.push(msg); }); }
  send(data) { this.ws.send(JSON.stringify(data)); }
  take(predicate) { const i = this.queue.findIndex(predicate); if (i >= 0) return Promise.resolve(this.queue.splice(i,1)[0]); return new Promise((resolve,reject) => { const waiter={predicate,resolve}; this.waiters.push(waiter); setTimeout(() => { const i=this.waiters.indexOf(waiter); if(i>=0){this.waiters.splice(i,1);reject(Error('Timed out waiting for message'));} },3000).unref(); }); }
  state(predicate=()=>true) { return this.take(m=>m.type==='state'&&predicate(m)); }
}
function solutionTokens(solution, numbers) {
  const used = new Set();
  return solution.match(/\d+|[()+−×÷-]/g).map(part => {
    if (/^\d+$/.test(part)) { const i=numbers.findIndex((n,i)=>n===Number(part)&&!used.has(i)); assert.notEqual(i,-1); used.add(i); return {t:'n',i}; }
    return {t:'o',v:({'−':'-','×':'*','÷':'/'}[part]||part)};
  });
}
test('two players pair, ready, race independently and see the winner', async () => {
  if (!app.server.listening) await once(app.server,'listening');
  const url=`ws://127.0.0.1:${app.server.address().port}/ws`;
  const a=new Client(new WebSocket(url)), b=new Client(new WebSocket(url));
  try {
    await Promise.all([once(a.ws,'open'),once(b.ws,'open')]);
    a.send({type:'create',name:'Alice',avatar:1});
    const joined=await a.take(m=>m.type==='joined');
    await a.state();
    b.send({type:'join',room:joined.room,name:'Bob',avatar:12});
    await b.take(m=>m.type==='joined');
    const lobby=await a.state(m=>m.players.length===2);
    assert.equal(lobby.players[1].name,'Bob');
    a.send({type:'ready',ready:true});
    await b.state(m=>m.players[0].ready);
    b.send({type:'ready',ready:true});
    await a.state(m=>m.players.every(p=>p.ready));
    a.send({type:'start'});
    await a.state(m=>m.phase==='playing');
    const room=app.rooms.get(joined.room);
    for(let level=1;level<=5;level++) {
      const puzzle=room.puzzles[level-1];
      if(level===1){
        const wrong=[{t:'n',i:0},{t:'o',v:'-'},{t:'n',i:1},{t:'o',v:'-'},{t:'n',i:2},{t:'o',v:'-'},{t:'n',i:3}];
        a.send({type:'submit',tokens:wrong});
        await a.take(m=>m.type==='wrong');
        assert.equal(room.players[0].level,1);
      }
      a.send({type:'submit',tokens:solutionTokens(puzzle.solution,puzzle.n)});
      const correct=await a.state(m=>m.result?.kind==='correct'&&m.players[0].level===level);
      assert.equal(correct.players[0].score,level);
      a.send({type:'next'});
      await a.state(m=>m.players[0].level===level+1||m.players[0].done);
    }
    const waiting=await b.state(m=>m.players[0].done&&m.players[1].level===1);
    assert.equal(waiting.phase,'playing');
    room.players[1].startedAt=Date.now()-app.LIMIT-1;
    b.send({type:'submit',tokens:[]});
    const timeout=await b.state(m=>m.result?.kind==='timeout');
    assert.equal(timeout.result.solution,room.puzzles[0].solution);
    b.send({type:'next'});
    await b.state(m=>m.players[1].level===2);
    for(let level=2;level<=5;level++) {
      b.send({type:'skip'});
      await b.state(m=>m.result?.kind==='skip'&&m.players[1].level===level);
      b.send({type:'next'});
      await b.state(m=>m.players[1].level===level+1||m.phase==='finished');
    }
    const finished=await a.state(m=>m.phase==='finished');
    assert.equal(finished.players[0].score,5);
    assert.equal(finished.players[1].score,0);
  } finally {
    a.ws.terminate(); b.ws.terminate();
    clearInterval(app.tick); app.wss.close(); app.server.close();
  }
});

