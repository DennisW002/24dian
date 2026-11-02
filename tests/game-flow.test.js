const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync(require('node:path').join(__dirname, '..', 'index.html'), 'utf8');
const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1];
const nodes = new Map();
function element(id) {
  if (!nodes.has(id)) {
    const classes = new Set(id === 'startOv' ? ['show'] : []);
    nodes.set(id, {
      textContent: '', innerHTML: '', hidden: id === 'retryBtn' || id === 'closeMsg', style: {},
      dataset: {}, focus() {}, addEventListener(type, fn) { this[type] = fn; },
      classList: { add: x => classes.add(x), remove: x => classes.delete(x),
        contains: x => classes.has(x), toggle: (x, on) => on ? classes.add(x) : classes.delete(x) }
    });
  }
  return nodes.get(id);
}
const ops = Object.fromEntries('+-*/()'.split('').map(v => [v, { dataset: { op: v }, addEventListener(type, fn) { this[type] = fn; } }]));
let now = 0, nextTimer = 1, closeCalled = false;
const timers = new Map();
const document = {
  body: element('body'), getElementById: element,
  querySelectorAll: () => Object.values(ops),
  addEventListener() {}
};
vm.runInNewContext(script, {
  document, Math: Object.assign(Object.create(Math), { random: () => 0 }), Date: { now: () => now },
  window: { close() { closeCalled = true; } }, setTimeout(fn) { fn(); },
  setInterval(fn) { const id = nextTimer++; timers.set(id, fn); return id; },
  clearInterval(id) { timers.delete(id); }
});
function advance(ms) { now += ms; for (const fn of [...timers.values()]) fn(); }
function card(i) { element('cards').click({ target: { closest: () => ({ dataset: { i: String(i) } }) } }); }
function op(v) { ops[v].click(); }
function answer(v) { for (let i = 0; i < 4; i++) { if (i) op(v); card(i); } element('submit').onclick(); }

element('startBtn').onclick();
assert.equal(element('time').textContent, '5:00');
assert.equal(element('level').textContent, '1/5');
advance(10_000);
element('pauseBtn').onclick();
assert.equal(document.body.classList.contains('paused'), true);
assert.equal(element('pauseOv').classList.contains('show'), true);
advance(30_000);
assert.equal(element('time').textContent, '4:50');
element('resumeBtn').onclick();
assert.equal(document.body.classList.contains('paused'), false);
answer('-');
assert.equal(element('resTitle').textContent, '不对哦');
assert.equal(element('retryBtn').hidden, false);
assert.equal(element('resMsg').textContent.includes('参考答案'), false);
advance(5_000);
element('retryBtn').onclick();
assert.equal(element('time').textContent, '4:45');
assert.equal(element('resOv').classList.contains('show'), false);
answer('-');
advance(285_000);
assert.equal(element('resTitle').textContent, '时间到');
assert.equal(element('retryBtn').hidden, true);
assert.match(element('resMsg').textContent, /正确答案：.+ = 24/);
element('nextBtn').onclick();
assert.equal(element('level').textContent, '2/5');
for (let level = 2; level <= 5; level++) {
  element('skip').onclick();
  element('nextBtn').onclick();
}
assert.equal(element('endOv').classList.contains('show'), true);
assert.equal(element('endScore').textContent, '0/5');
element('closeBtn').onclick();
assert.equal(closeCalled, true);
assert.equal(element('closeMsg').hidden, false);
element('againBtn').onclick();
answer('+');
assert.equal(element('resTitle').textContent, '答对了！+1 分');
assert.equal(element('score').textContent, 1);
console.log('pause, retry, timeout, results, close, correct answer: OK');

