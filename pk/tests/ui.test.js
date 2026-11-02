const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
function element() {
  const classes = new Set();
  return {
    children: [], style: { setProperty() {} }, classList: { add: x => classes.add(x), remove: x => classes.delete(x), contains: x => classes.has(x) },
    append(child) { this.children.push(child); }, remove() {}, replaceChildren() { this.children = []; }, focus() {}, select() {}
  };
}
test('full-screen effects use particles and invitation copies the room link', async () => {
  const nodes = new Map();
  const copied = [];
  const document = {
    getElementById(id) { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); },
    createElement() { return element(); }, addEventListener() {}
  };
  const context = vm.createContext({
    document, navigator: { clipboard: { async writeText(value) { copied.push(value); } } },
    location: { search: '', origin: 'https://example.com' }, URLSearchParams, Math,
    setTimeout() {}, clearTimeout() {}
  });
  vm.runInContext(source, context);
  vm.runInContext("state={room:'abc123',phase:'playing',you:'p1',players:[{id:'p1',done:false}]};showInterference('pig');showInterference('sparkle')", context);
  const scenes = document.getElementById('interferenceLayer').children;
  assert.equal(scenes.length, 2);
  assert.equal(scenes[0].children.length, 14);
  assert.equal(scenes[0].children[0].children[0].src, '/avatars/1f437.svg');
  assert.equal(scenes[1].children.length, 32);
  await vm.runInContext('openInviteGuide()', context);
  assert.equal(copied[0], 'https://example.com/?room=abc123');
  assert.match(document.getElementById('inviteGuideStatus').textContent, /微信聊天中粘贴/);
  const css = fs.readFileSync(path.join(__dirname, '../public/style.css'), 'utf8');
  assert.match(css, /\.interferenceLayer\{[^}]*pointer-events:none/);
  assert.doesNotMatch(source, /navigator\.share/);
});
