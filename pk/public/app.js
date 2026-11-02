const $ = id => document.getElementById(id);
let roomFromUrl = new URLSearchParams(location.search).get('room');
const avatars = [
  ...[['宇航员','1f468-200d-1f680'],['厨师','1f468-200d-1f373'],['画家','1f468-200d-1f3a8'],['消防员','1f468-200d-1f692'],['科学家','1f468-200d-1f52c']].map(([name,code])=>({name:`男${name}`,type:'male',code})),
  ...[['宇航员','1f469-200d-1f680'],['厨师','1f469-200d-1f373'],['画家','1f469-200d-1f3a8'],['消防员','1f469-200d-1f692'],['科学家','1f469-200d-1f52c']].map(([name,code])=>({name:`女${name}`,type:'female',code})),
  ...[['小熊','1f43b'],['小兔','1f430'],['小猫','1f431'],['小狐','1f98a'],['小狗','1f436']].map(([name,code])=>({name,type:'animal',code})),
  ...['😀','😎','🤖','👽','🥳'].map((name,i)=>({name,type:'emoji',i}))
];
function avatarHtml(n) { const a=avatars[n]||avatars[0]; return a.type==='emoji'?`<span class="emoji" aria-label="${a.name}">${a.name}</span>`:`<img src="/avatars/${a.code}.svg" alt="${a.name}">`; }
function esc(s) { return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
let selected=0, socket, state=null, tokens=[], shownLevel=0, localWrong=false, clockBase=0, clockRemaining=300000;
let interferenceMuted=false, interferenceClockBase=0, interferenceCooldownMs=0;
function toast(message) { $('toast').textContent=message; $('toast').classList.remove('hidden'); clearTimeout(toast.id); toast.id=setTimeout(()=>$('toast').classList.add('hidden'),3500); }
function send(data) { if(socket?.readyState===WebSocket.OPEN) socket.send(JSON.stringify(data)); else toast('连接中，请稍后再试'); }
function connect() {
  socket=new WebSocket(`${location.protocol==='https:'?'wss':'ws'}://${location.host}/ws`);
  socket.onopen=()=>{ const token=roomFromUrl&&localStorage.getItem(`pk:${roomFromUrl}`); if(token) send({type:'reconnect',room:roomFromUrl,token}); };
  socket.onmessage=event=>{
    const msg=JSON.parse(event.data);
    if(msg.type==='joined') { roomFromUrl=msg.room; localStorage.setItem(`pk:${msg.room}`,msg.token); history.replaceState(null,'',`?room=${msg.room}`); }
    else if(msg.type==='state') { state=msg; render(); }
    else if(msg.type==='wrong') { localWrong=true; showResult('wrong',msg.message); }
    else if(msg.type==='interference') showInterference(msg.effect);
    else if(msg.type==='error') { toast(msg.message); if(msg.message.includes('过期')) { localStorage.removeItem(`pk:${roomFromUrl}`); roomFromUrl=null; state=null; history.replaceState(null,'',location.pathname); $('entryTitle').textContent='发起一场对战'; $('enterBtn').textContent='创建房间'; showSections('entry'); } }
  };
  socket.onclose=()=>{ toast('连接中断，正在重连'); setTimeout(connect,2000); };
}
function showSections(which) { for(const id of ['entry','lobby','game','waiting','finish']) $(id).classList.toggle('hidden',id!==which); }
function showInterference(effect) {
  if(interferenceMuted || state?.phase!=='playing' || state.players.find(p=>p.id===state.you)?.done) return;
  const text={pig:'🐷 小猪路过！',sparkle:'✨ 星星闪闪！',wink:'😜 别分心哦！'}[effect];
  if(!text) return;
  const card=document.createElement('div');
  card.className=`effect effect-${effect}`;
  card.textContent=text;
  $('interferenceLayer').append(card);
  setTimeout(()=>card.remove(),2500);
}
function renderInterferenceControls() {
  if(state?.phase!=='playing') return;
  const me=state.players.find(p=>p.id===state.you);
  if(!me?.done) return;
  const other=state.players.find(p=>p.id!==state.you);
  const remaining=Math.max(0,interferenceCooldownMs-(Date.now()-interferenceClockBase));
  const exhausted=state.interference.used>=state.interference.limit;
  $('interferenceActions').querySelectorAll('button').forEach(button=>{button.disabled=exhausted||remaining>0||!other?.online||other.done;});
  $('interferenceStatus').textContent=exhausted?'本场次数已用完':remaining>0?`冷却中，还需 ${Math.ceil(remaining/1000)} 秒`:`剩余 ${state.interference.limit-state.interference.used} 次${other?.online?'':' · 对手离线'}`;
}
function playerCard(p, me, phase) {
  const status=phase==='lobby'?(p.ready?'已准备':'未准备'):p.done?'已完成':`第 ${p.level} / 5 关`;
  return `<div class="player">${avatarHtml(p.avatar)}<div><strong>${esc(p.name)}${p.id===me?'（你）':''}</strong><small>${status}${p.online?'':' · 离线'}</small></div><span class="badge">${p.score} 分</span></div>`;
}
function render() {
  const me=state.players.find(p=>p.id===state.you), other=state.players.find(p=>p.id!==state.you);
  if(state.phase==='lobby') {
    showSections('lobby'); $('result').classList.add('hidden');
    $('roomPlayers').innerHTML=state.players.map(p=>playerCard(p,state.you,'lobby')).join('')+(other?'':'<div class="player"><div><strong>等待朋友加入…</strong><small>把邀请链接发给朋友</small></div></div>');
    $('inviteUrl').textContent=`${location.origin}/?room=${state.room}`;
    $('readyBtn').textContent=me.ready?'取消准备':'准备';
    $('startBtn').classList.toggle('hidden',state.host!==state.you);
    $('startBtn').disabled=state.players.length!==2||state.players.some(p=>!p.ready);
    $('lobbyHint').textContent=state.players.length<2?'等待朋友通过邀请链接加入。':state.players.every(p=>p.ready)?'双方已准备，发起者可以开始对战。':`${other.name}：${other.ready?'已准备':'未准备'}`;
  } else if(state.phase==='finished') {
    showSections('finish'); $('result').classList.add('hidden');
    $('interferenceLayer').replaceChildren();
    const winner=state.players.find(p=>p.id===state.winner);
    $('winnerTitle').textContent=winner?`${winner.name} 是 Winner！`:'平局！';
    $('finalPlayers').innerHTML=state.players.map(p=>`<div class="player">${avatarHtml(p.avatar)}<div><strong>${esc(p.name)}</strong><small>得分 ${p.score} / 5<br>总耗时 ${formatTime(p.elapsedMs)}</small></div></div>`).join('');
  } else if(me.done) {
    showSections('waiting'); $('result').classList.add('hidden');
    $('waitingPlayers').innerHTML=state.players.map(p=>playerCard(p,state.you,'playing')).join('');
    interferenceClockBase=Date.now(); interferenceCooldownMs=state.interference.cooldownMs;
    renderInterferenceControls();
  } else {
    showSections('game'); $('progress').innerHTML=state.players.map(p=>playerCard(p,state.you,'playing')).join('');
    if(me.level!==shownLevel) { shownLevel=me.level; tokens=[]; localWrong=false; $('hint').textContent=''; }
    $('level').textContent=me.level;
    clockBase=Date.now(); clockRemaining=state.remainingMs; renderClock();
    renderInput();
    if(state.result) { localWrong=false; showResult(state.result.kind,state.result.solution); }
    else if(!localWrong) $('result').classList.add('hidden');
  }
}
function formatTime(ms) { const s=Math.round(ms/1000); return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`; }
function renderClock() { if(state?.phase!=='playing'||!state.numbers) return; const ms=state.result?0:Math.max(0,clockRemaining-(Date.now()-clockBase)); $('time').textContent=formatTime(Math.ceil(ms/1000)*1000); $('time').classList.toggle('urgent',ms<=30000); }
function renderInput() {
  const used=new Set(tokens.filter(t=>t.t==='n').map(t=>t.i));
  $('cards').innerHTML=state.numbers.map((n,i)=>`<button class="card${used.has(i)?' used':''}" data-index="${i}" ${used.has(i)?'disabled':''}>${n}</button>`).join('');
  const sym={'+':'+','-':'−','*':'×','/':'÷','(':'(',')':')'};
  $('expr').textContent=tokens.length?tokens.map(t=>t.t==='n'?state.numbers[t.i]:sym[t.v]).join(' '):'点击数字和运算符组成算式';
}
function showResult(kind, detail) {
  const data={correct:['✓','答对了！','本关得 1 分。'],timeout:['⌛','时间到',`正确答案：${detail} = 24`],skip:['→','已放弃','本关不得分。'],wrong:['✗','不对哦',detail]};
  const [icon,title,message]=data[kind]||data.wrong;
  $('resultIcon').textContent=icon; $('resultTitle').textContent=title; $('resultText').textContent=message;
  $('retryBtn').classList.toggle('hidden',kind!=='wrong');
  $('nextBtn').textContent=state?.players.find(p=>p.id===state.you)?.level===5?'完成对战':'下一关';
  $('result').classList.remove('hidden');
}
function addNum(i) { if(!state||state.phase!=='playing'||localWrong||state.result) return; if(tokens.some(t=>t.t==='n'&&t.i===i)) return; const last=tokens.at(-1); if(last&&(last.t==='n'||last.v===')')) return toast('数字前面需要运算符'); tokens.push({t:'n',i}); renderInput(); }
function addOp(v) { if(state?.phase!=='playing'||localWrong||state.result) return; tokens.push({t:'o',v}); renderInput(); }
document.addEventListener('DOMContentLoaded',()=>{
  $('entryTitle').textContent=roomFromUrl?'加入朋友的对战':'发起一场对战'; $('enterBtn').textContent=roomFromUrl?'加入对战':'创建房间';
  $('avatars').innerHTML=[['男生角色',0],['女生角色',5],['动物角色',10],['Emoji',15]].map(([label,start])=>`<div class="avatarGroup"><h3>${label}</h3><div class="avatarGrid">${avatars.slice(start,start+5).map((a,i)=>`<button class="avatarChoice${start+i===0?' selected':''}" data-avatar="${start+i}" title="${a.name}" aria-label="${a.name}">${avatarHtml(start+i)}</button>`).join('')}</div></div>`).join('');
  $('avatars').onclick=e=>{ const b=e.target.closest('[data-avatar]'); if(!b) return; selected=Number(b.dataset.avatar); document.querySelectorAll('.avatarChoice').forEach(x=>x.classList.toggle('selected',x===b)); };
  $('enterBtn').onclick=()=>{ const name=$('name').value.trim(); if(!name) return toast('请输入玩家名字'); send({type:roomFromUrl?'join':'create',room:roomFromUrl,name,avatar:selected}); };
  $('readyBtn').onclick=()=>{ const me=state.players.find(p=>p.id===state.you); send({type:'ready',ready:!me.ready}); };
  $('startBtn').onclick=()=>send({type:'start'});
  const invite=()=>`${location.origin}/?room=${state.room}`;
  $('copyBtn').onclick=async()=>{ try{await navigator.clipboard.writeText(invite());toast('邀请链接已复制');}catch{toast('复制失败，请长按链接复制');} };
  $('shareBtn').onclick=async()=>{ if(navigator.share) { try{await navigator.share({title:'胖猪来24点 · 双人 PK',text:'来和我在线玩胖猪来24点！',url:invite()});}catch{} } else $('copyBtn').onclick(); };
  $('cards').onclick=e=>{ const b=e.target.closest('[data-index]'); if(b) addNum(Number(b.dataset.index)); };
  $('operators').onclick=e=>{ const b=e.target.closest('[data-op]'); if(b) addOp(b.dataset.op); };
  $('backBtn').onclick=()=>{tokens.pop();renderInput();}; $('clearBtn').onclick=()=>{tokens=[];renderInput();};
  $('submitBtn').onclick=()=>send({type:'submit',tokens}); $('skipBtn').onclick=()=>send({type:'skip'});
  $('retryBtn').onclick=()=>{localWrong=false;tokens=[];$('result').classList.add('hidden');renderInput();};
  $('nextBtn').onclick=()=>{ if(localWrong) {localWrong=false;send({type:'giveup'});} else send({type:'next'}); };
  $('newBtn').onclick=()=>{location.href=location.origin+'/';};
  $('interferenceActions').onclick=e=>{const button=e.target.closest('[data-effect]');if(button&&!button.disabled) send({type:'interfere',effect:button.dataset.effect});};
  $('muteBtn').onclick=()=>{interferenceMuted=!interferenceMuted;$('muteBtn').setAttribute('aria-pressed',String(interferenceMuted));$('muteBtn').textContent=interferenceMuted?'开启干扰':'关闭干扰';$('interferenceLayer').replaceChildren();};
  setInterval(renderClock,200);
  setInterval(renderInterferenceControls,250);
  setInterval(()=>{ if(socket?.readyState===WebSocket.OPEN) send({type:'ping'}); },30000);
  connect();
});
