const $ = id => document.getElementById(id);
let roomFromUrl = new URLSearchParams(location.search).get('room');
const avatars = [
  ...['阿杰','小宇','阿诚','乐乐','大川'].map((name,i)=>({name,type:'male',i})),
  ...['小晴','安安','可可','阿月','小岚'].map((name,i)=>({name,type:'female',i})),
  ...['小熊','小兔','小猫','小狐','小狗'].map((name,i)=>({name,type:'animal',i})),
  ...['😀','😎','🤖','👽','🥳'].map((name,i)=>({name,type:'emoji',i}))
];
const skin = ['#f4c6a7','#d99a73','#efb892','#b98263','#f3d1ad'];
const hair = ['#322923','#563a2b','#b56b3d','#292f44','#673b35'];
const shirt = ['#5a7fa7','#e19b57','#6d9e83','#9477ae','#d97772'];
const animal = ['#b87d51','#e5d7c5','#a9a8a7','#dc914d','#bb956f'];
function svgFor(a) {
  const i=a.i, face=skin[i], h=hair[i], top=shirt[i];
  let art;
  if(a.type==='animal') {
    const ears = i===1 ? '<ellipse cx="15" cy="18" rx="7" ry="18"/><ellipse cx="49" cy="18" rx="7" ry="18"/>'
      : i===2 ? '<path d="M8 27 9 8 24 18M40 18 55 8 56 27"/>'
      : '<circle cx="16" cy="18" r="10"/><circle cx="48" cy="18" r="10"/>';
    art=`<g fill="${animal[i]}">${ears}<circle cx="32" cy="34" r="24"/></g><ellipse cx="32" cy="43" rx="13" ry="10" fill="#f7e3cf"/><circle cx="23" cy="33" r="2.5"/><circle cx="41" cy="33" r="2.5"/><path d="M29 43q3 4 6 0" fill="none" stroke="#43342e" stroke-width="2" stroke-linecap="round"/>`;
  } else {
    const long=a.type==='female';
    art=`<path d="M8 64q2-18 24-18t24 18" fill="${top}"/>${long?`<ellipse cx="32" cy="28" rx="22" ry="27" fill="${h}"/>`:''}<circle cx="32" cy="31" r="19" fill="${face}"/><path d="M13 27q0-20 19-20t19 20q-8-9-19-7-10-1-19 7" fill="${h}"/>${!long&&i%2===0?`<path d="M15 17q15-17 32-1" fill="none" stroke="${h}" stroke-width="7"/>`:''}<circle cx="25" cy="32" r="2"/><circle cx="39" cy="32" r="2"/><path d="M27 41q5 5 10 0" fill="none" stroke="#9b514f" stroke-width="2" stroke-linecap="round"/>`;
  }
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect width="64" height="64" rx="18" fill="#f1e7d7"/>${art}</svg>`)}`;
}
function avatarHtml(n) { const a=avatars[n]||avatars[0]; return a.type==='emoji'?`<span class="emoji" aria-label="${a.name}">${a.name}</span>`:`<img src="${svgFor(a)}" alt="${a.name}">`; }
function esc(s) { return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
let selected=0, socket, state=null, tokens=[], shownLevel=0, localWrong=false, clockBase=0, clockRemaining=300000;
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
    else if(msg.type==='error') { toast(msg.message); if(msg.message.includes('过期')) { localStorage.removeItem(`pk:${roomFromUrl}`); roomFromUrl=null; state=null; history.replaceState(null,'',location.pathname); $('entryTitle').textContent='发起一场对战'; $('enterBtn').textContent='创建房间'; showSections('entry'); } }
  };
  socket.onclose=()=>{ toast('连接中断，正在重连'); setTimeout(connect,2000); };
}
function showSections(which) { for(const id of ['entry','lobby','game','waiting','finish']) $(id).classList.toggle('hidden',id!==which); }
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
    const max=Math.max(...state.players.map(p=>p.score)), winners=state.players.filter(p=>p.score===max);
    $('winnerTitle').textContent=winners.length===2?'平局！':`${winners[0].name} 是 Winner！`;
    $('finalPlayers').innerHTML=state.players.map(p=>`<div class="player">${avatarHtml(p.avatar)}<div><strong>${esc(p.name)}</strong><small>得分 ${p.score} / 5<br>总耗时 ${formatTime(p.elapsedMs)}</small></div></div>`).join('');
  } else if(me.done) {
    showSections('waiting'); $('result').classList.add('hidden');
    $('waitingPlayers').innerHTML=state.players.map(p=>playerCard(p,state.you,'playing')).join('');
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
  $('avatars').innerHTML=avatars.map((a,i)=>`<button class="avatarChoice${i===0?' selected':''}" data-avatar="${i}" title="${a.name}" aria-label="${a.name}">${avatarHtml(i)}</button>`).join('');
  $('avatars').onclick=e=>{ const b=e.target.closest('[data-avatar]'); if(!b) return; selected=Number(b.dataset.avatar); document.querySelectorAll('.avatarChoice').forEach(x=>x.classList.toggle('selected',x===b)); };
  $('enterBtn').onclick=()=>{ const name=$('name').value.trim(); if(!name) return toast('请输入玩家名字'); send({type:roomFromUrl?'join':'create',room:roomFromUrl,name,avatar:selected}); };
  $('readyBtn').onclick=()=>{ const me=state.players.find(p=>p.id===state.you); send({type:'ready',ready:!me.ready}); };
  $('startBtn').onclick=()=>send({type:'start'});
  const invite=()=>`${location.origin}/?room=${state.room}`;
  $('copyBtn').onclick=async()=>{ try{await navigator.clipboard.writeText(invite());toast('邀请链接已复制');}catch{toast('复制失败，请长按链接复制');} };
  $('shareBtn').onclick=async()=>{ if(navigator.share) { try{await navigator.share({title:'24 点双人 PK',text:'来和我在线玩 24 点！',url:invite()});}catch{} } else $('copyBtn').onclick(); };
  $('cards').onclick=e=>{ const b=e.target.closest('[data-index]'); if(b) addNum(Number(b.dataset.index)); };
  $('operators').onclick=e=>{ const b=e.target.closest('[data-op]'); if(b) addOp(b.dataset.op); };
  $('backBtn').onclick=()=>{tokens.pop();renderInput();}; $('clearBtn').onclick=()=>{tokens=[];renderInput();};
  $('submitBtn').onclick=()=>send({type:'submit',tokens}); $('skipBtn').onclick=()=>send({type:'skip'});
  $('retryBtn').onclick=()=>{localWrong=false;tokens=[];$('result').classList.add('hidden');renderInput();};
  $('nextBtn').onclick=()=>{ if(localWrong) {localWrong=false;send({type:'giveup'});} else send({type:'next'}); };
  $('newBtn').onclick=()=>{location.href=location.origin+'/';};
  setInterval(renderClock,200);
  setInterval(()=>{ if(socket?.readyState===WebSocket.OPEN) send({type:'ping'}); },30000);
  connect();
});

