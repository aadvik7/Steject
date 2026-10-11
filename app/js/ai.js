/*
 * STEJECT AI clients (local Ollama, free cloud Groq) and the Telegram client.
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

  // ------------------------------------------------------------------ Groq (free cloud AI)
  // OpenAI-compatible API. The user brings their own free key from console.groq.com.
  const GROQ_BASE = "https://api.groq.com/openai/v1";
  const GROQ_MODELS = [
    { id: "llama-3.3-70b-versatile", note: "Recommended. Good all-round choice for writing projects and explaining code." },
    { id: "openai/gpt-oss-120b", note: "Strongest reasoning. Slower, and uses more of your free limit." },
    { id: "openai/gpt-oss-20b", note: "Lighter and faster." },
    { id: "llama-3.1-8b-instant", note: "Fastest. Fine for short answers, weaker on whole projects." },
  ];
  const NOT_CHAT = /whisper|orpheus|guard|tts|compound|embed|safeguard/i;

  function groq(key) {
    const auth = { Authorization: "Bearer " + key };
    const sleep = (ms, signal) => new Promise((res, rej) => {
      const t = setTimeout(res, ms);
      if (signal) signal.addEventListener("abort", () => { clearTimeout(t); rej(new DOMException("Aborted", "AbortError")); }, { once: true });
    });

    // Groq's 429 text says how long to wait, e.g. "Please try again in 1.5s" or "7m12.3s"
    function waitFromMessage(msg) {
      const m = /try again in\s+([0-9hms.]+)/i.exec(msg || "");
      if (!m) return 0;
      let sec = 0, t;
      const re = /(\d+(?:\.\d+)?)(ms|h|m|s)/g;
      while ((t = re.exec(m[1]))) sec += parseFloat(t[1]) * { ms: 0.001, s: 1, m: 60, h: 3600 }[t[2]];
      return sec;
    }

    async function failure(res) {
      let msg = "";
      try { msg = ((await res.json()).error || {}).message || ""; } catch {}
      let e;
      if (res.status === 401) e = new Error("Groq rejected the API key. Copy it again from console.groq.com/keys.");
      else if (res.status === 404) e = new Error("Groq doesn't have that model. Pick another one in Settings.");
      else if (res.status === 413) e = new Error("That is too big for this Groq model's size limit. Try a smaller project or another model.");
      else if (res.status === 429) {
        const daily = /per day|\bTPD\b|\bRPD\b/i.test(msg);
        e = new Error(daily
          ? "You've used today's free Groq limit for this model. Pick another model in Settings, switch to Ollama, or try again tomorrow."
          : "Groq's free limit for the last minute is used up. Wait a minute and try again.");
        e.daily = daily;
        e.retryAfter = parseFloat(res.headers.get("retry-after")) || waitFromMessage(msg);
      } else e = new Error(`Groq error ${res.status}${msg ? ": " + msg.slice(0, 200) : ""}`);
      e.status = res.status; e.detail = msg;
      return e;
    }

    // fetch with a short wait on per-minute limits and one retry on server errors
    async function call(path, init, signal, onWait) {
      for (let attempt = 0; ; attempt++) {
        let res;
        try { res = await fetch(GROQ_BASE + path, { ...init, signal }); }
        catch (e) {
          if (e.name === "AbortError") throw e;
          throw new Error("Couldn't reach Groq. Check your internet connection. (In a normal browser tab Groq can block direct calls; the desktop app doesn't have that limit.)");
        }
        if (res.ok) return res;
        const err = await failure(res);
        if (err.status === 429 && !err.daily && attempt < 2 && err.retryAfter > 0 && err.retryAfter <= 30) {
          onWait && onWait(Math.ceil(err.retryAfter));
          await sleep(err.retryAfter * 1000 + 300, signal);
          continue;
        }
        if (err.status >= 500 && attempt < 1) { await sleep(1500, signal); continue; }
        throw err;
      }
    }

    return {
      /** Checks the key and returns the chat models it can use. */
      async status() {
        try {
          const res = await call("/models", { method: "GET", headers: auth });
          const data = await res.json();
          const ids = (data.data || []).map(m => m.id).filter(id => id && !NOT_CHAT.test(id));
          return { ok: true, models: ids };
        } catch (e) {
          return { ok: false, reason: e.status === 401 ? "badkey" : "error", message: e.message };
        }
      },
      /** Streams a reply. onText(fullTextSoFar); onWait(seconds); onFinish(reason). */
      async chat(model, messages, { onText, json, signal, temperature = 0.2, maxTokens, onWait, onFinish } = {}) {
        const body = { model, messages, stream: true, temperature };
        if (maxTokens) body.max_tokens = maxTokens;
        if (/^openai\/gpt-oss/.test(model)) body.reasoning_effort = "low";
        if (json) body.response_format = { type: "json_object" };
        const send = () => call("/chat/completions", { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify(body) }, signal, onWait);
        let res;
        try { res = await send(); }
        catch (e) {
          // a model that doesn't accept an optional setting, or can't produce strict JSON:
          // drop the extras and try once more (callers already pull JSON out of plain text)
          if (e.status === 400 && /response_format|reasoning|json/i.test(e.detail || "") && (body.response_format || body.reasoning_effort)) {
            delete body.response_format; delete body.reasoning_effort;
            res = await send();
          } else throw e;
        }
        const reader = res.body.getReader(), dec = new TextDecoder();
        let buf = "", text = "", finish = null;
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let i;
          while ((i = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
            if (!line.startsWith("data:")) continue;
            const data = line.slice(5).trim();
            if (!data || data === "[DONE]") continue;
            let j; try { j = JSON.parse(data); } catch { continue; }
            if (j.error) throw new Error("Groq: " + (j.error.message || "error"));
            const ch = j.choices && j.choices[0];
            if (!ch) continue;
            if (ch.delta && ch.delta.content) { text += ch.delta.content; onText && onText(text); }
            if (ch.finish_reason) finish = ch.finish_reason;
          }
        }
        onFinish && onFinish(finish);
        return text.replace(/<think>[\s\S]*?<\/think>/g, "");
      },
    };
  }

  // ------------------------------------------------------------------ prompts
  const SYS = "You are STEJECT's assistant, helping a student understand and ship a coding project. Be accurate, concrete and brief. Never invent files that are not in the project.";

  const prompts = {
    idea(idea, size) {
      const scale = size === "medium" ? "5 to 9 files, none longer than 150 lines" : "3 to 6 files, none longer than 100 lines";
      return [
        { role: "system", content: "You write complete, working, beginner-friendly projects for students and output them in the STEJECT manifest format. Output ONLY the manifest: no explanations and no markdown fences." },
        { role: "user", content:
`Write this project: ${String(idea).trim().slice(0, 1200)}

Output format (exactly):
=== PROJECT: <short-kebab-case-name> ===
=== FILE: <relative/path> ===
<full file contents>
=== COMMIT: <imperative commit message> ===

Rules:
- ${scale}. Every file complete and runnable. No placeholders or TODOs.
- 3 to 5 commits in build order: setup and core first, then features, tests, and README last. A file goes before the COMMIT line it belongs to.
- Include README.md (what it is, how to run it, how to test it) and a .gitignore.
- Add a small test file when the language has a standard test tool.
- Use only the standard library or very common packages. No API keys, accounts or network services.
- Relative paths only. Text files only (no images or binaries).
- Never write a line that starts with "=== " inside a file.` },
      ];
    },
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

  const api = { MODELS, GROQ_MODELS, ollama, groq, prompts, telegram };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.SteAI = api;
})(typeof self !== "undefined" ? self : this);
