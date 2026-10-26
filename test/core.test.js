import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WaitGroupTimer } from '../src/index.js';

/**
 * A fake clock: holds a logical time in ms and lets tests advance it
 * explicitly so no assertion depends on wall-clock time.
 */
class FakeClock {
  constructor(start = 0) {
    this.t = start;
  }
  now() {
    return this.t;
  }
  advance(ms) {
    this.t += ms;
  }
}

test('add and done before deadline yields completed', () => {
  const clock = new FakeClock(100);
  const wg = new WaitGroupTimer({ now: () => clock.now() });
  const t = wg.add('fetch', 50);
  clock.advance(10);
  wg.done(t);
  assert.equal(wg.status(t).state, 'completed');
});

test('status reports pending before deadline when not done', () => {
  const clock = new FakeClock(0);
  const wg = new WaitGroupTimer({ now: () => clock.now() });
  const t = wg.add('job', 100);
  assert.equal(wg.status(t).state, 'pending');
});

test('status reports expired when deadline reached without done', () => {
  const clock = new FakeClock(0);
  const wg = new WaitGroupTimer({ now: () => clock.now() });
  const t = wg.add('job', 100);
  clock.advance(100);
  assert.equal(wg.status(t).state, 'expired');
});

test('boundary at exactly deadline is expired, not pending', () => {
  const clock = new FakeClock(0);
  const wg = new WaitGroupTimer({ now: () => clock.now() });
  const t = wg.add('job', 100);
  clock.advance(100);
  assert.equal(wg.status(t).state, 'expired');
});

test('done after deadline still marks completed (facts are recorded)', () => {
  const clock = new FakeClock(0);
  const wg = new WaitGroupTimer({ now: () => clock.now() });
  const t = wg.add('job', 50);
  clock.advance(60);
  wg.done(t);
  assert.equal(wg.status(t).state, 'completed');
});

test('summary partitions completed, expired, pending', () => {
  const clock = new FakeClock(1000);
  const wg = new WaitGroupTimer({ now: () => clock.now() });
  const a = wg.add('a', 50);
  const b = wg.add('b', 200);
  wg.add('c', 400);
  clock.advance(60);
  wg.done(a);
  clock.advance(200);
  wg.done(b);
  clock.advance(150);
  // now at 1410; c deadline 1400 -> expired, c not done
  const s = wg.summary();
  assert.equal(s.completed.length, 2);
  assert.equal(s.expired.length, 1);
  assert.equal(s.pending.length, 0);
});

test('duplicate names are tracked independently', () => {
  const clock = new FakeClock(0);
  const wg = new WaitGroupTimer({ now: () => clock.now() });
  const t1 = wg.add('op', 10);
  const t2 = wg.add('op', 100);
  assert.notEqual(t1, t2);
  clock.advance(10);
  wg.done(t1);
  clock.advance(95);
  const s = wg.summary();
  assert.equal(s.completed.length, 1);
  assert.equal(s.expired.length, 1);
});

test('add throws when sealed', () => {
  const wg = new WaitGroupTimer({ now: () => 0 });
  wg.add('x', 10);
  wg.seal();
  assert.throws(() => wg.add('y', 10), /sealed/);
});

test('done with unknown token throws', () => {
  const wg = new WaitGroupTimer({ now: () => 0 });
  wg.add('x', 10);
  assert.throws(() => wg.done(999), /Unknown token/);
});

test('calling done twice throws', () => {
  const clock = new FakeClock(0);
  const wg = new WaitGroupTimer({ now: () => clock.now() });
  const t = wg.add('x', 10);
  wg.done(t);
  assert.throws(() => wg.done(t), /already completed/);
});

test('invalid constructor argument throws', () => {
  assert.throws(() => new WaitGroupTimer({}), /now/);
});

test('add with invalid name or timeout throws', () => {
  const wg = new WaitGroupTimer({ now: () => 0 });
  assert.throws(() => wg.add('', 10), /name/);
  assert.throws(() => wg.add('x', -1), /timeoutMs/);
  assert.throws(() => wg.add('x', Number.NaN), /timeoutMs/);
});
