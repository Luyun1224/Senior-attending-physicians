const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
new vm.Script(script);
const handlerScript = script.slice(script.indexOf('    document.getElementById("surveyForm").addEventListener'));

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return {promise, resolve, reject};
}

function setup() {
  const post = deferred();
  const verification = deferred();
  const button = {disabled: false, textContent: '送出回饋'};
  const toast = {style: {}, setAttribute() {}, scrollIntoView() {}};
  let handler, posts = 0, resets = 0, request, timer;
  const fields = new Map();
  const form = {
    reportValidity: () => true,
    querySelector: () => button,
    reset() { resets++; },
    addEventListener(_, fn) { handler = fn; }
  };
  const context = vm.createContext({
    document: {
      getElementById(id) {
        if (id === 'surveyForm') return form;
        if (id === 'toast') return toast;
        if (!fields.has(id)) fields.set(id, {value: 'original answer', checked: false, disabled: false});
        return fields.get(id);
      },
      querySelector: () => ({value: '5'})
    },
    AbortController,
    console: {warn() {}, error() {}},
    setTimeout(fn) { timer = fn; return 1; }, clearTimeout() {},
    makeSubmissionId: () => 'same-submission-id', setToday() {},
    GAS_WEB_APP_URL: 'https://example.test',
    verifyWithRetry: () => verification.promise,
    fetch(_, options) {
      posts++;
      request = options;
      options.signal.addEventListener('abort', () => post.reject(new Error('aborted')));
      return post.promise;
    }
  });
  vm.runInContext(handlerScript, context);
  return {
    submit: () => handler.call(form, {preventDefault() {}}),
    post, verification, button, toast,
    posts: () => posts, resets: () => resets, request: () => request,
    timeout: () => timer()
  };
}

test('shows success immediately while both network and verification are still pending', async () => {
  const app = setup();
  const pending = app.submit();
  assert.match(app.toast.innerHTML, /回饋已成功送出/);
  assert.equal(app.toast.style.display, 'block');
  assert.equal(app.button.textContent, '已送出');
  assert.equal(app.resets(), 0);
  assert.equal(app.request().keepalive, true);
  assert.equal(JSON.parse(app.request().body).teacher, 'original answer');
  await app.submit();
  assert.equal(app.posts(), 1);
  app.post.resolve({type: 'opaque'});
  await Promise.resolve();
  assert.match(app.toast.innerHTML, /回饋已成功送出/);
  assert.equal(app.button.textContent, '已送出');
  app.verification.resolve(true);
  await pending;
  assert.equal(app.resets(), 1);
  assert.equal(app.button.disabled, false);
});

test('unconfirmed background write warns and preserves answers without resending', async () => {
  const app = setup();
  const pending = app.submit();
  app.post.reject(new Error('network failed'));
  app.verification.resolve(false);
  await pending;
  assert.match(app.toast.innerHTML, /尚未確認資料成功寫入/);
  assert.equal(app.resets(), 0);
  assert.equal(app.posts(), 1);
  assert.equal(app.button.disabled, false);
});

test('POST timeout can still be confirmed without a duplicate POST', async () => {
  const app = setup();
  const pending = app.submit();
  app.timeout();
  assert.equal(app.request().signal.aborted, true);
  app.verification.resolve(true);
  await pending;
  assert.match(app.toast.innerHTML, /回饋已成功送出/);
  assert.equal(app.posts(), 1);
  assert.equal(app.resets(), 1);
});
