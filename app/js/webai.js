/*
 * STEJECT in-browser AI, page side. Checks WebGPU support, talks to js/webai-worker.js,
 * and offers the same chat() interface as the other AI helpers.
 */
(function (root) {
  "use strict";
  const MODELS = [
    { id: "Qwen2.5-Coder-1.5B-Instruct-q4f16_1-MLC", alt: "Qwen2.5-Coder-1.5B-Instruct-q4f32_1-MLC", name: "Qwen2.5 Coder 1.5B", note: "Recommended. Made for code; best for Learn and small projects." },
    { id: "Llama-3.2-1B-Instruct-q4f16_1-MLC", alt: "Llama-3.2-1B-Instruct-q4f32_1-MLC", name: "Llama 3.2 1B", note: "Good at plain-words explanations. Weaker at writing code." },
    { id: "Qwen2.5-0.5B-Instruct-q4f16_1-MLC", alt: "Qwen2.5-0.5B-Instruct-q4f32_1-MLC", name: "Qwen2.5 0.5B", note: "Smallest and fastest download. Only for short answers." },
  ];

  /** Can this device run it? {ok, f16} or {ok: false, reason} */
  async function probe() {
    const nav = root.navigator;
    if (!nav || !nav.gpu) return { ok: false, reason: "This browser doesn't support WebGPU, which the in-browser AI needs. Try a recent Chrome or Edge, or use Groq or Ollama." };
    let adapter = null;
    try { adapter = await nav.gpu.requestAdapter(); } catch {}
    if (!adapter) return { ok: false, reason: "Not supported on this device: WebGPU couldn't find a usable graphics card. Use Groq or Ollama instead." };
    return { ok: true, f16: !!(adapter.features && adapter.features.has && adapter.features.has("shader-f16")) };
  }
  /** The model variant this device can run (graphics cards without 16-bit math need the f32 build). */
  const variant = (m, f16) => f16 === false ? m.alt : m.id;

  let worker = null, seq = 0;
  const handlers = new Map();
  function getWorker() {
    if (worker) return worker;
    worker = new Worker("js/webai-worker.js");
    worker.onmessage = e => { const h = handlers.get(e.data && e.data.id); if (h) h(e.data); };
    worker.onerror = e => { const err = new Error((e && e.message) || "The in-browser AI stopped."); handlers.forEach(h => h({ type: "error", message: err.message })); handlers.clear(); worker = null; };
    return worker;
  }
  function call(op, data, onEvent) {
    return new Promise((resolve, reject) => {
      const id = ++seq;
      handlers.set(id, d => {
        if (d.type === "result") { handlers.delete(id); resolve(d); }
        else if (d.type === "error") { handlers.delete(id); reject(new Error(d.message)); }
        else if (onEvent) onEvent(d);
      });
      getWorker().postMessage({ id, op, ...data });
    });
  }

  const info = model => call("info", { model });
  const size = model => call("size", { model });
  const load = (model, onProgress) => call("load", { model }, d => { if (d.type === "progress" && onProgress) onProgress(d); });
  const remove = model => call("delete", { model });
  const env = () => call("env", {});

  // small models read about 4,000 tokens; keep prompts inside that by trimming the longest message's middle
  function fit(messages, ctxTokens, maxTokens) {
    const room = Math.max(1200, (ctxTokens - maxTokens - 200) * 3);   // ~3 characters per token, on the safe side
    const total = messages.reduce((n, m) => n + m.content.length, 0);
    if (total <= room) return messages;
    const out = messages.map(m => ({ ...m }));
    const big = out.reduce((a, m, i) => (m.content.length > out[a].content.length ? i : a), 0);
    const keep = Math.max(400, out[big].content.length - (total - room));
    const c = out[big].content;
    out[big].content = c.slice(0, Math.floor(keep * 0.7)) + "\n…(cut to fit the small in-browser model)…\n" + c.slice(c.length - Math.floor(keep * 0.3));
    return out;
  }

  /** chat() like the other helpers. opts.ctx: the model's context window in tokens. */
  function client(model, hooks) {
    hooks = hooks || {};
    return {
      async chat(_model, messages, { onText, json, signal, temperature = 0.2, maxTokens, onFinish, ctxTokens } = {}) {
        hooks.onRequest && hooks.onRequest();
        const max = Math.min(maxTokens || 1500, 2048);
        const msgs = fit(messages, ctxTokens || hooks.ctx || 4096, max);
        const onAbort = () => { if (worker) worker.postMessage({ op: "abort" }); };
        if (signal) { if (signal.aborted) throw new DOMException("Aborted", "AbortError"); signal.addEventListener("abort", onAbort, { once: true }); }
        try {
          const r = await call("chat", { model, messages: msgs, json: !!json, temperature, maxTokens: max }, d => { if (d.type === "chunk" && onText) onText(d.text); });
          if (signal && signal.aborted) throw new DOMException("Aborted", "AbortError");
          if (r.usage && hooks.onUsage) hooks.onUsage({ total: r.usage.total_tokens || 0 });
          onFinish && onFinish(r.finish);
          return String(r.text || "").replace(/<think>[\s\S]*?<\/think>/g, "");
        } finally { if (signal) signal.removeEventListener("abort", onAbort); }
      },
    };
  }

  root.SteWebAI = { MODELS, probe, variant, info, size, load, remove, env, client, fit };
})(typeof self !== "undefined" ? self : this);
