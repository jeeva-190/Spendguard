class AsyncLocalStorage { run(s, fn) { this.s = s; return fn(); } getStore() { return this.s; } }
module.exports = { AsyncLocalStorage };
