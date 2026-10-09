/*
 * STEJECT local AI (Ollama) and Telegram clients.
 * In the desktop app, the main process removes browser CORS limits for these
 * hosts, so plain fetch works. In a browser, Ollama needs OLLAMA_ORIGINS set.
 */
(function (root) {
  "use strict";

  // ------------------------------------------------------------------ Ollama
  const MODELS = [
    { id: "qwen2.5-coder:3b", size: "1.9 GB", note: "Recommended. Fast on most laptops (8 GB RAM)." },
    { id: "qwen2.5-coder:7b", size: "4.7 GB", note: "Better answers. Needs 16 GB RAM." },
    { id: "llama3.2:3b", size: "2.0 GB", note: "Good general explainer." },
    { id: "qwen2.5-coder:1.5b", size: "1.0 GB", note: "For older laptops. Weaker." },
  ];

  function ollama(baseUrl) {
    const base = (baseUrl || "http://localhost:11434").replace(/\/+$/, "");

    // text/plain avoids a CORS preflight; Ollama reads the JSON body anyway
    async function post(path, body, signal) {
      let res;
      try {
        res = await fetch(base + path, { method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify(body), signal });
      } catch (e) {
        if (e.name === "AbortError") throw e;
        throw new Error("Can't reach Ollama at " + base + ". Is it installed and running?");
      }
      if (res.status === 403) throw new Error("Ollama refused the request. In a browser, set OLLAMA_ORIGINS to allow this page (the desktop app doesn't need this).");
      if (!res.ok) { const t = await res.text().catch(() => ""); throw new Error(`Ollama error ${res.status}: ${t.slice(0, 200)}`); }
      return res;
    }

    async function* lines(res) {
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
          if (line) yield JSON.parse(line);
        }
      }
      if (buf.trim()) yield JSON.parse(buf.trim());
    }

    return {
      base,
      async status() {
        try {
          const res = await fetch(base + "/api/tags", { cache: "no-store" });
          if (res.status === 403) return { ok: false, reason: "blocked" };
          const data = await res.json();
          let version = null;
          try { version = (await (await fetch(base + "/api/version")).json()).version; } catch {}
          return { ok: true, version, models: (data.models || []).map(m => ({ name: m.name, size: m.size })) };
        } catch {
          return { ok: false, reason: "offline" };
        }
      },
      /** Download a model. onProgress({status, completed, total}) */
      async pull(model, onProgress, signal) {
        const res = await post("/api/pull", { model, name: model, stream: true }, signal);
        for await (const msg of lines(res)) {
          if (msg.error) throw new Error(msg.error);
          onProgress && onProgress(msg);
        }
      },
      /** Chat. onText(fullTextSoFar) streams; resolves with the full text. */
      async chat(model, messages, { onText, json, signal, temperature = 0.2, ctx = 8192 } = {}) {
        const res = await post("/api/chat", {
          model, messages, stream: true,
          ...(json ? { format: "json" } : {}),
          options: { temperature, num_ctx: ctx },
        }, signal);
        let text = "";
        for await (const msg of lines(res)) {
          if (msg.error) throw new Error(msg.error);
          if (msg.message && msg.message.content) { text += msg.message.content; onText && onText(text); }
        }
        return text;
      },
    };
  }

  // ------------------------------------------------------------------ prompts
  const SYS = "You are STEJECT's assistant, helping a student understand and ship a coding project. Be accurate, concrete and brief. Never invent files that are not in the project.";

  const prompts = {
    fixManifest(raw) {
      return [
        { role: "system", content: "You convert text into the STEJECT manifest format. Output ONLY the manifest, nothing else." },
        { role: "user", content:
`Convert the project below into this exact format:

=== PROJECT: <folder-name> ===
=== FILE: <relative/path> ===
<full file contents, copied exactly>
=== COMMIT: <short commit message> ===

Rules: copy every file's code exactly, character for character. Group files into 3 to 6 logical commits. Every file must come before its COMMIT line. Use relative paths only. Do not add explanations.

TEXT TO CONVERT:
${raw}` },
      ];
    },
    readme(digest) {
      return [
        { role: "system", content: SYS },
        { role: "user", content: `Write a README.md for this project. Sections: title and one-line summary, Features, Tech stack, Getting started (install and run commands that match the files), Project structure, How it works. Use only facts visible in the files. Output only the Markdown.\n\n${digest}` },
      ];
    },
    explain(path, content, digest) {
      return [
        { role: "system", content: SYS },
        { role: "user", content: `Explain the file "${path}" to a student who must present this project in an interview.\n\nFormat:\n## What it does\n2-3 sentences.\n## How it works\nWalk through the important parts in order, quoting short code snippets.\n## Key concepts\nBullet list of the concepts used, one line each.\n## Interview questions\n3 questions an interviewer might ask about this file, each with a short model answer.\n\nProject context:\n${digest.slice(0, 3000)}\n\nFILE ${path}:\n${content.slice(0, 9000)}` },
      ];
    },
    quiz(digest, n) {
      return [
        { role: "system", content: SYS + " Respond with JSON only." },
        { role: "user", content: `Create ${n} multiple-choice questions that test real understanding of THIS project's code (not generic trivia). Mix: what a function does, why a design choice was made, what happens on bad input, how files connect.\n\nReturn JSON: {"questions":[{"q":"question","options":["A","B","C","D"],"answer":0,"why":"one-sentence explanation","file":"path"}]}\n"answer" is the index (0-3) of the correct option.\n\n${digest}` },
      ];
    },
    resume(digest) {
      return [
        { role: "system", content: SYS },
        { role: "user", content: `Write 3 resume bullet points for this project. Each starts with a strong past-tense verb, names the real technologies used, and says what was built or achieved. No invented metrics or numbers. One line each, no intro text.\n\n${digest}` },
      ];
    },
    commitPlan(digest) {
      return [
        { role: "system", content: SYS + " Respond with JSON only." },
        { role: "user", content: `Split these files into 3 to 7 logical commits in build order (setup first, docs last). Return JSON: {"commits":[{"message":"Imperative commit message","files":["path", "..."]}]}. Use every file exactly once.\n\n${digest}` },
      ];
    },
  };

  // ------------------------------------------------------------------ Telegram
  async function telegram(token, method, params) {
    const url = `https://api.telegram.org/bot${token}/${method}`;
    const body = new URLSearchParams(params);
    let res;
    try {
      res = await fetch(url, { method: "POST", body });
    } catch (e) {
      // the browser may block reading the reply even though Telegram got it
      if (method === "sendMessage") {
        try { await fetch(url, { method: "POST", body, mode: "no-cors" }); return { unconfirmed: true }; }
        catch {}
      }
      throw new Error("Can't reach Telegram. Check your internet connection.");
    }
    const data = await res.json().catch(() => null);
    if (!data || !data.ok) {
      const d = (data && data.description) || `error ${res.status}`;
      if (/unauthorized/i.test(d)) throw new Error("Telegram rejected the bot token. Copy it again from @BotFather.");
      if (/chat not found/i.test(d)) throw new Error("Chat not found. Send your bot a message first, then use Find my chat ID.");
      throw new Error("Telegram said: " + d);
    }
    return data.result;
  }

  const api = { MODELS, ollama, prompts, telegram };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.SteAI = api;
})(typeof self !== "undefined" ? self : this);
