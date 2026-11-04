const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
function element() {
  const classes = new Set();
  return {
    children: [], style: { setProperty() {} }, classList: { add: x => classes.add(x), remove: x => classes.delete(x), contains: x => classes.has(x), toggle: (x,on) => on ? classes.add(x) : classes.delete(x) },
    append(child) { this.children.push(child); }, remove() {}, replaceChildren() { this.children = []; }, focus() {}, select() {}
  };
}
test('full-screen effects use particles and invitation copies the room link', async () => {
  const nodes = new Map();
  const copied = [];
  const urls = [];
  const stored = new Map([['pk:lastRoom','abc123'],['pk:abc123','host-token']]);
  const leaveButtons = Array.from({length:4},element);
  const document = {
    getElementById(id) { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); },
    createElement() { return element(); }, querySelectorAll() { return leaveButtons; }, addEventListener() {}
  };
  const context = vm.createContext({
    document, navigator: { clipboard: { async writeText(value) { copied.push(value); } } },
    localStorage: { getItem:key=>stored.get(key)||null, setItem:(key,value)=>stored.set(key,value), removeItem:key=>stored.delete(key) },
    location: { search: '', origin: 'https://example.com', pathname: '/' }, history: { replaceState(_a,_b,url) { urls.push(url); } }, URLSearchParams, Math,
    setTimeout() {}, clearTimeout() {}
  });
  vm.runInContext(source, context);
  assert.equal(vm.runInContext('resumeTarget()',context),null);
  vm.runInContext("roomFromUrl='abc123'",context);
  const resume=vm.runInContext('resumeTarget()',context);
  assert.equal(resume.room,'abc123');
  assert.equal(resume.token,'host-token');
  vm.runInContext("state={room:'abc123',phase:'playing',you:'p1',players:[{id:'p1',done:false}]};['pig','sparkle','wink','candy','flower','butterfly','balloon','heart','duck','cloud'].forEach(showInterference)", context);
  const scenes = document.getElementById('interferenceLayer').children;
  assert.equal(scenes.length, 10);
  assert.equal(scenes[0].children.length, 14);
  assert.equal(scenes[0].children[0].children[0].src, '/avatars/1f437.svg');
  assert.equal(scenes[1].children.length, 32);
  vm.runInContext("renderOfflineControls({id:'p2',online:false})",context);
  assert.equal(document.getElementById('gameOffline').classList.contains('hidden'),false);
  assert.equal(document.getElementById('resultOffline').classList.contains('hidden'),false);
  vm.runInContext("renderOfflineControls({id:'p2',online:true})",context);
  assert.equal(document.getElementById('gameOffline').classList.contains('hidden'),true);
  const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  assert.equal((html.match(/data-effect="/g)||[]).length, 10);
  assert.equal((html.match(/data-leave/g)||[]).length, 4);
  await vm.runInContext('openInviteGuide()', context);
  assert.equal(copied[0], 'https://example.com/?room=abc123');
  assert.match(document.getElementById('inviteGuideStatus').textContent, /微信聊天中粘贴/);
  vm.runInContext('resetRoom()',context);
  assert.equal(stored.has('pk:abc123'),false);
  assert.equal(urls.at(-1),'/');
  assert.equal(vm.runInContext('resumeTarget()',context),null);
  const css = fs.readFileSync(path.join(__dirname, '../public/style.css'), 'utf8');
  assert.match(css, /\.interferenceLayer\{[^}]*pointer-events:none/);
  assert.doesNotMatch(source, /navigator\.share/);
});
