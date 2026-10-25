/**
 * Core of wait-group-timer: a registry that tracks named operations
 * against deadlines derived from a user-supplied clock, and reports which
 * operations completed before their deadline versus which exceeded it.
 *
 * Design choices:
 * - The clock is injected. Callers pass a `now()` function returning
 *   milliseconds as a number. Tests use a fake clock so assertions never
 *   depend on wall-clock time.
 * - When an operation exceeds its deadline we do NOT fire any callback.
 *   The caller learns about it by calling `status()` or `summary()`. This
 *   keeps the object passive: it only records facts derived from the clock
 *   and the methods you call. A timeout-triggered callback would race with
 *   a late `done()` call in a way that is hard to reason about under a fake
 *   clock; instead, the deadline is evaluated lazily at query time.
 * - Operation names are arbitrary strings; duplicate names are allowed and
 *   tracked independently by a monotonic internal id. This means "a" can be
 *   added twice, each with its own deadline, and both will appear in the
 *   report. We picked this over rejecting duplicates because rejecting would
 *   force the caller to synthesise unique names, which defeats the purpose of
 *   a wait group.
 */

/**
 * @typedef {Object} WaitGroupTimerOptions
 * @property {() => number} now
 *   Returns the current logical time in milliseconds. Required.
 */

/**
 * @typedef {Object} OperationRecord
 * @property {string} name
 * @property {number} addedAt
 * @property {number} deadline
 * @property {number | null} completedAt
 */

/**
 * @typedef {Object} OperationStatus
 * @property {string} name
 * @property {('pending'|'completed'|'expired')} state
 * @property {number} addedAt
 * @property {number} deadline
 * @property {number | null} completedAt
 */

/**
 * @typedef {Object} GroupSummary
 * @property {Array<OperationStatus>} completed
 * @property {Array<OperationStatus>} expired
 * @property {Array<OperationStatus>} pending
 */

export class WaitGroupTimer {
  /**
   * @param {WaitGroupTimerOptions} options
   */
  constructor({ now }) {
    if (typeof now !== 'function') {
      throw new TypeError('WaitGroupTimer requires a `now()` function');
    }
    /** @type {() => number} */
    this._now = now;
    /** @type {Array<OperationRecord>} */
    this._ops = [];
    /** @type {number} */
    this._nextId = 0;
    /** @type {Map<number, number>} id -> index in _ops */
    this._index = new Map();
    /** @type {boolean} */
    this._sealed = false;
  }

  /**
   * @param {string} name
   * @param {number} timeoutMs
   * @returns {number} A token to pass to `done(token)`. Using a numeric
   *   token rather than the name means duplicate names can be completed
   *   independently and unambiguously.
   */
  add(name, timeoutMs) {
    if (this._sealed) {
      throw new Error('WaitGroupTimer is sealed; cannot add operations');
    }
    if (typeof name !== 'string' || name.length === 0) {
      throw new TypeError('`name` must be a non-empty string');
    }
    if (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs) || timeoutMs < 0) {
      throw new TypeError('`timeoutMs` must be a finite, non-negative number');
    }
    const now = this._now();
    const id = this._nextId++;
    const record = {
      name,
      addedAt: now,
      deadline: now + timeoutMs,
      completedAt: null,
    };
    this._index.set(id, this._ops.length);
    this._ops.push(record);
    return id;
  }

  /**
   * @param {number} token
   * @returns {void}
   */
  done(token) {
    if (typeof token !== 'number' || !Number.isInteger(token)) {
      throw new TypeError('`token` must be an integer id returned by add()');
    }
    const idx = this._index.get(token);
    if (idx === undefined) {
      throw new Error(`Unknown token: ${token}`);
    }
    const record = this._ops[idx];
    if (record.completedAt !== null) {
      throw new Error(`Operation ${token} already completed`);
    }
    record.completedAt = this._now();
  }

  /**
   * Prevents further `add()` calls. This exists so a caller can state
   * clearly "the group is full"; `summary()` and `status()` work whether
   * or not the group is sealed.
   * @returns {void}
   */
  seal() {
    this._sealed = true;
  }

  /**
   * @returns {boolean}
   */
  get sealed() {
    return this._sealed;
  }

  /**
   * @param {number} token
   * @returns {OperationStatus}
   */
  status(token) {
    if (typeof token !== 'number' || !Number.isInteger(token)) {
      throw new TypeError('`token` must be an integer id returned by add()');
    }
    const idx = this._index.get(token);
    if (idx === undefined) {
      throw new Error(`Unknown token: ${token}`);
    }
    return this._statusFor(this._ops[idx]);
  }

  /**
   * @returns {GroupSummary}
   */
  summary() {
    const now = this._now();
    const completed = [];
    const expired = [];
    const pending = [];
    for (const record of this._ops) {
      const st = this._statusFor(record, now);
      if (st.state === 'completed') completed.push(st);
      else if (st.state === 'expired') expired.push(st);
      else pending.push(st);
    }
    return { completed, expired, pending };
  }

  /**
   * @param {OperationRecord} record
   * @param {number} [nowOverride]
   * @returns {OperationStatus}
   */
  _statusFor(record, nowOverride) {
    const now = nowOverride !== undefined ? nowOverride : this._now();
    const state =
      record.completedAt !== null
        ? 'completed'
        : now >= record.deadline
        ? 'expired'
        : 'pending';
    return {
      name: record.name,
      state,
      addedAt: record.addedAt,
      deadline: record.deadline,
      completedAt: record.completedAt,
    };
  }
}
