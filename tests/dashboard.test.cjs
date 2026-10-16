const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '..', 'dashboard.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
new vm.Script(script);

function overview(rows, now = '2026-10-16T08:00:00Z') {
  const metrics = {};
  const heading = {};
  const context = vm.createContext({
    allRows: rows,
    Date: class extends Date { constructor(...args) { super(...(args.length ? args : [now])); } },
    document: { getElementById: () => heading },
    animateNumber: (id, value) => { metrics[id] = value; }
  });
  vm.runInContext(script.slice(script.indexOf('function num('), script.indexOf('function jsonp(')), context);
  vm.runInContext(script.slice(script.indexOf('function renderPeriodOverview('), script.indexOf('function renderKpis(')), context);
  vm.runInContext('renderPeriodOverview()', context);
  return { metrics, heading };
}
function row(date, teacher, q10 = 5) {
  return { date, teacher, ...Object.fromEntries(Array.from({length: 10}, (_, i) => ['q' + (i + 1), 5])), q10 };
}

test('August overview counts responses, deduplicates sessions and excludes other dates', () => {
  const { metrics, heading } = overview([
    row('2026-08-01', 'A'), row('2026-08-01', 'A', 4), row('2026-10-16', 'B', 3),
    row('2026-07-31', 'C'), row('2025-10-01', 'D'), row('2026-10-17', 'E'), row('', 'F')
  ]);
  assert.equal(metrics.periodN, 3);
  assert.equal(metrics.periodSessions, 2);
  assert.ok(Math.abs(metrics.periodSat - 200 / 3) < 0.00001);
  assert.ok(Math.abs(metrics.periodAvg - 4.9) < 0.00001);
  assert.match(heading.textContent, /2026 年 8 月/);
});

test('missing scores remain unavailable rather than appearing as zero satisfaction or average', () => {
  const { metrics } = overview([{date:'2026-09-01',teacher:'A',q1:'',q10:null}]);
  assert.equal(metrics.periodN, 1);
  assert.equal(metrics.periodSat, null);
  assert.equal(metrics.periodAvg, null);
});

test('Taipei date determines the current year and excludes future August sessions', () => {
  const { metrics, heading } = overview([row('2026-08-01','A'), row('2027-08-01','B')], '2026-12-31T16:30:00Z');
  assert.match(heading.textContent, /2027 年 8 月/);
  assert.equal(metrics.periodN, 0);
  assert.equal(metrics.periodSessions, 0);
  assert.equal(metrics.periodSat, null);
});
