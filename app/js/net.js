/*
 * STEJECT network helper. The page's security policy (index.html) lists the hosts
 * the app may call directly. Calls to any other AI address the user added go
 * through js/networker.js; fetch() here returns a normal streaming Response either way.
 */
(function (root) {
  "use strict";
  // keep in sync with connect-src in index.html
  const DIRECT = [
    "https://api.github.com", "https://raw.githubusercontent.com", "https://api.telegram.org",
    "https://api.groq.com", "https://openrouter.ai", "https://generativelanguage.googleapis.com",
    "https://registry.npmjs.org", "https://pypi.org",
  ];
  const isLocal = u => u.protocol === "http:" && /^(localhost|127\.0\.0\.1)$/.test(u.hostname);
  function direct(url) {
    try { const u = new URL(url, location.href); return u.origin === location.origin || DIRECT.includes(u.origin) || isLocal(u); }
    catch { return false; }
  }

  let worker = null, seq = 0;
  const handlers = new Map();
  function getWorker() {
    if (worker) return worker;
    worker = new Worker("js/networker.js");
    worker.onmessage = e => { const h = handlers.get(e.data && e.data.id); if (h) h(e.data); };
    return worker;
  }
  const NULL_BODY = [101, 204, 205, 304];

  /** fetch() through the network worker. Supports streaming bodies and AbortSignal. */
  function viaWorker(url, init) {
    init = init || {};
    const { signal, ...rest } = init;   // rest (method, headers object, string body) is plain data the worker can receive
    return new Promise((resolve, reject) => {
      if (signal && signal.aborted) return reject(new DOMException("Aborted", "AbortError"));
      const w = getWorker(), id = ++seq;
      let ctl = null, started = false;
      const stream = new ReadableStream({ start(c) { ctl = c; }, cancel() { w.postMessage({ id, type: "abort" }); } });
      const fail = err => { handlers.delete(id); if (started) { try { ctl.error(err); } catch {} } else reject(err); };
      handlers.set(id, d => {
        if (d.type === "head") {
          started = true;
          resolve(new Response(NULL_BODY.includes(d.status) ? null : stream, { status: d.status, statusText: d.statusText, headers: d.headers }));
        } else if (d.type === "chunk") ctl.enqueue(new Uint8Array(d.value));
        else if (d.type === "end") { handlers.delete(id); try { ctl.close(); } catch {} }
        else if (d.type === "error") { const err = d.name === "AbortError" ? new DOMException("Aborted", "AbortError") : new TypeError(d.message); fail(err); }
      });
      if (signal) signal.addEventListener("abort", () => { w.postMessage({ id, type: "abort" }); fail(new DOMException("Aborted", "AbortError")); }, { once: true });
      w.postMessage({ id, type: "fetch", url: String(url), init: rest });
    });
  }

  /** Like fetch(): direct for the built-in hosts, through the worker for user-chosen ones. */
  function smartFetch(url, init) { return direct(url) ? fetch(url, init) : viaWorker(url, init); }

  root.SteNet = { DIRECT, direct, fetch: smartFetch, viaWorker };
})(typeof self !== "undefined" ? self : this);
