/*
 * STEJECT in-browser AI (Web Worker). Runs a small model on this computer's graphics card
 * with WebGPU, through WebLLM. Nothing is downloaded until the student clicks Download;
 * the model is then kept in the browser's cache. Prompts never leave the computer.
 */
"use strict";
const LIB = "https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.86/+esm";
let lib = null, engine = null, loaded = null;

async function webllm() {
  if (!lib) {
    try { lib = await import(LIB); }
    catch (e) { throw new Error("Couldn't download the in-browser AI library from cdn.jsdelivr.net. Check your internet connection."); }
  }
  return lib;
}
async function record(id) {
  const L = await webllm();
  const rec = L.prebuiltAppConfig.model_list.find(m => m.model_id === id);
  if (!rec) throw new Error("STEJECT doesn't know the model " + id + ".");
  return rec;
}

self.onmessage = async e => {
  const d = e.data || {}, id = d.id;
  const reply = msg => postMessage({ id, ...msg });
  try {
    if (d.op === "env") return reply({ type: "result", caches: typeof caches !== "undefined", gpu: !!(self.navigator && navigator.gpu) });
    if (d.op === "size") {
      // just the model's file list (a small JSON), so the size can be shown before the student agrees to download
      const base = "https://huggingface.co/mlc-ai/" + encodeURIComponent(d.model) + "/resolve/main/";
      const cache = await (await fetch(base + "ndarray-cache.json")).json();
      // WebLLM runs these models with a 4,096-token window, whatever their own config says
      return reply({ type: "result", bytes: (cache.records || []).reduce((n, r) => n + (r.nbytes || 0), 0), ctx: 4096 });
    }
    if (d.op === "info") {
      // download size from the model's file list, before anything is downloaded
      const L = await webllm(), rec = await record(d.model);
      const base = String(rec.model).replace(/\/+$/, "");
      let bytes = 0;
      try {
        const res = await fetch(base + "/resolve/main/ndarray-cache.json");
        const cache = await res.json();
        bytes = (cache.records || []).reduce((n, r) => n + (r.nbytes || 0), 0);
      } catch {}
      let cached = false;
      try { cached = await L.hasModelInCache(d.model); } catch {}
      return reply({ type: "result", bytes, vram: rec.vram_required_MB || 0, ctx: (rec.overrides && rec.overrides.context_window_size) || 4096, cached });
    }
    if (d.op === "load") {
      const L = await webllm();
      if (engine && loaded === d.model) return reply({ type: "result", ok: true });
      if (engine) { try { await engine.unload(); } catch {} engine = null; loaded = null; }
      engine = await L.CreateMLCEngine(d.model, { initProgressCallback: p => postMessage({ id, type: "progress", progress: p.progress || 0, text: p.text || "" }) });
      loaded = d.model;
      return reply({ type: "result", ok: true });
    }
    if (d.op === "chat") {
      if (!engine || loaded !== d.model) throw new Error("The model isn't loaded yet.");
      const req = { messages: d.messages, stream: true, stream_options: { include_usage: true }, temperature: d.temperature, max_tokens: d.maxTokens };
      if (d.json) req.response_format = { type: "json_object" };
      const stream = await engine.chat.completions.create(req);
      let text = "", usage = null, finish = null;
      for await (const ch of stream) {
        const c = ch.choices && ch.choices[0];
        if (c && c.delta && c.delta.content) { text += c.delta.content; postMessage({ id, type: "chunk", text }); }
        if (c && c.finish_reason) finish = c.finish_reason;
        if (ch.usage) usage = ch.usage;
      }
      return reply({ type: "result", text, usage, finish });
    }
    if (d.op === "abort") { if (engine) engine.interruptGenerate(); return; }
    if (d.op === "delete") {
      const L = await webllm();
      if (loaded === d.model && engine) { try { await engine.unload(); } catch {} engine = null; loaded = null; }
      await L.deleteModelAllInfoInCache(d.model);
      return reply({ type: "result", ok: true });
    }
    throw new Error("Unknown request.");
  } catch (err) {
    reply({ type: "error", message: String(err && err.message || err) });
  }
};
