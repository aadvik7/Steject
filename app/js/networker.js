/*
 * STEJECT network worker: makes requests to the AI address the user added in
 * Settings (a college server, a provider not on the built-in list). The page's
 * security policy only allows a fixed list of hosts; this worker is the one
 * place that can reach a user-chosen https address, and it refuses anything else
 * (plain http only to this computer). Responses stream back to the page.
 */
"use strict";
const running = new Map();

function allowed(url) {
  try {
    const u = new URL(url);
    return u.protocol === "https:" || (u.protocol === "http:" && /^(localhost|127\.0\.0\.1)$/.test(u.hostname));
  } catch { return false; }
}

self.onmessage = async e => {
  const { id, type, url, init } = e.data || {};
  if (type === "abort") { const c = running.get(id); if (c) c.abort(); return; }
  if (type !== "fetch") return;
  const ctrl = new AbortController();
  running.set(id, ctrl);
  try {
    if (!allowed(url)) throw new TypeError("STEJECT only calls https addresses, or http on this computer.");
    const res = await fetch(url, { ...init, signal: ctrl.signal, credentials: "omit", referrerPolicy: "no-referrer" });
    postMessage({ id, type: "head", status: res.status, statusText: res.statusText, headers: [...res.headers] });
    if (res.body) {
      const reader = res.body.getReader();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        postMessage({ id, type: "chunk", value }, [value.buffer]);
      }
    }
    postMessage({ id, type: "end" });
  } catch (err) {
    postMessage({ id, type: "error", name: err && err.name || "Error", message: String(err && err.message || err) });
  } finally { running.delete(id); }
};
