'use strict';

class Emitter {
  constructor() {
    this._listeners = new Map();
    this.hooks = { on: () => {}, off: () => {} };
  }

  on(event, listener, options) {
    if (!this._listeners.has(event)) this._listeners.set(event, []);
    this._listeners.get(event).push(listener);
    if (options?.signal) {
      options.signal.addEventListener('abort', () => this.off(event, listener));
    }
    return this;
  }

  off(event, listener) {
    if (!this._listeners.has(event)) return this;
    const ls = this._listeners.get(event);
    const i = ls.indexOf(listener);
    if (i !== -1) ls.splice(i, 1);
    return this;
  }

  addListener(event, listener, options) { return this.on(event, listener, options); }
  removeListener(event, listener) { return this.off(event, listener); }

  removeAllListeners(event) {
    if (event !== undefined) this._listeners.delete(event);
    else this._listeners.clear();
    return this;
  }

  emit(event) {
    const name = typeof event === 'string' ? event : event?.type;
    const direct = this._listeners.get(name) || [];
    const wildcard = this._listeners.get('*') || [];
    for (const fn of [...direct, ...wildcard]) {
      try { fn(event); } catch (_) {}
    }
    return this;
  }
}

module.exports = { Emitter };
