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

  // ------------------------------------------------------------------ OpenAI-style APIs (Groq, OpenRouter, Gemini, LM Studio, …)
  // Groq is the built-in free cloud option; "custom" is any address that speaks the same API.
  const GROQ_BASE = "https://api.groq.com/openai/v1";
  const PRESETS = [
    { id: "openrouter", name: "OpenRouter", base: "https://openrouter.ai/api/v1", keyUrl: "https://openrouter.ai/keys", model: "meta-llama/llama-3.3-70b-instruct:free" },
    { id: "gemini", name: "Google Gemini", base: "https://generativelanguage.googleapis.com/v1beta/openai", keyUrl: "https://aistudio.google.com/apikey", model: "gemini-2.5-flash" },
    { id: "lmstudio", name: "LM Studio", base: "http://localhost:1234/v1", keyUrl: "", model: "" },
  ];
  /** Is this an address STEJECT may call? https anywhere, or http on this computer only. */
  function validBase(url) {
    try {
      const u = new URL(String(url).trim());
      return u.protocol === "https:" || (u.protocol === "http:" && /^(localhost|127\.0\.0\.1)$/.test(u.hostname));
    } catch { return false; }
  }
  const GROQ_MODELS = [
    { id: "llama-3.3-70b-versatile", note: "Recommended. Good all-round choice for writing projects and explaining code." },
    { id: "openai/gpt-oss-120b", note: "Strongest reasoning. Slower, and uses more of your free limit." },
    { id: "openai/gpt-oss-20b", note: "Lighter and faster." },
    { id: "llama-3.1-8b-instant", note: "Fastest. Fine for short answers, weaker on whole projects." },
  ];
  const NOT_CHAT = /whisper|orpheus|guard|tts|compound|embed|safeguard/i;

  function groq(key, hooks) { return compat({ base: GROQ_BASE, key, name: "Groq", keyHelp: "Copy it again from console.groq.com/keys.", groq: true, ...hooks }); }

  /**
   * Client for an OpenAI-compatible API.
   * opts: {base, key, name, keyHelp, groq, fetch, onRequest(), onUsage({prompt, completion, total})}
   */
  function compat(opts) {
    const BASE = String(opts.base || GROQ_BASE).replace(/\/+$/, "");
    const NAME = opts.name || "The AI service";
    const auth = opts.key ? { Authorization: "Bearer " + opts.key } : {};
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
      try { const j = await res.json(); msg = (j.error && (j.error.message || (typeof j.error === "string" ? j.error : ""))) || j.message || ""; } catch {}
      let e;
      if (res.status === 401 || res.status === 403 && /key|auth|permission/i.test(msg)) e = new Error(`${NAME} rejected the API key. ${opts.keyHelp || "Check the key in Settings."}`);
      else if (res.status === 404) e = new Error(`${NAME} doesn't have that model, or the address is wrong. Pick another model in Settings.`);
      else if (res.status === 413) e = new Error(`That is too big for this ${NAME} model's size limit. Try a smaller project or another model.`);
      else if (res.status === 429) {
        const daily = /per day|\bTPD\b|\bRPD\b|daily|quota/i.test(msg);
        e = new Error(daily
          ? `You've used today's free ${NAME} limit for this model. Pick another model in Settings, switch provider, or try again tomorrow.`
          : `${NAME}'s free limit for the last minute is used up. Wait a minute and try again.`);
        e.daily = daily;
        e.retryAfter = parseFloat(res.headers.get("retry-after")) || waitFromMessage(msg);
      } else e = new Error(`${NAME} error ${res.status}${msg ? ": " + msg.slice(0, 200) : ""}`);
      e.status = res.status; e.detail = msg;
      return e;
    }

    // fetch with a short wait on per-minute limits and one retry on server errors
    async function call(path, init, signal, onWait) {
      for (let attempt = 0; ; attempt++) {
        let res;
        try { res = await (opts.fetch || fetch)(BASE + path, { ...init, signal }); }
        catch (e) {
          if (e.name === "AbortError") throw e;
          throw new Error(opts.groq
            ? "Couldn't reach Groq. Check your internet connection. (In a normal browser tab Groq can block direct calls; the desktop app doesn't have that limit.)"
            : `Couldn't reach ${BASE}. Check the address and your connection. In a browser tab the service may block direct calls; the desktop app doesn't have that limit.`);
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
      base: BASE,
      /** Checks the key and returns the chat models it can use (models: null if the service has no list). */
      async status() {
        try {
          const res = await call("/models", { method: "GET", headers: auth });
          const data = await res.json();
          const ids = (data.data || data.models || []).map(m => (m.id || m.name || "").replace(/^models\//, "")).filter(id => id && !NOT_CHAT.test(id));
          return { ok: true, models: ids };
        } catch (e) {
          if (!opts.groq && e.status === 404) return { ok: true, models: null };
          return { ok: false, reason: e.status === 401 ? "badkey" : "error", message: e.message };
        }
      },
      /** Streams a reply. onText(fullTextSoFar); onWait(seconds); onFinish(reason). */
      async chat(model, messages, { onText, json, signal, temperature = 0.2, maxTokens, onWait, onFinish } = {}) {
        const body = { model, messages, stream: true, temperature };
        if (maxTokens) body.max_tokens = maxTokens;
        if (/^openai\/gpt-oss/.test(model)) body.reasoning_effort = "low";
        if (json) body.response_format = { type: "json_object" };
        if (!opts.groq) body.stream_options = { include_usage: true };   // Groq reports usage on its own
        const send = () => call("/chat/completions", { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify(body) }, signal, onWait);
        let res;
        opts.onRequest && opts.onRequest();
        try { res = await send(); }
        catch (e) {
          // a model that doesn't accept an optional setting, or can't produce strict JSON:
          // drop the extras and try once more (callers already pull JSON out of plain text)
          if (e.status === 400 && /response_format|reasoning|json|stream_options/i.test(e.detail || "") && (body.response_format || body.reasoning_effort || body.stream_options)) {
            delete body.response_format; delete body.reasoning_effort; delete body.stream_options;
            res = await send();
          } else throw e;
        }
        const reader = res.body.getReader(), dec = new TextDecoder();
        let buf = "", text = "", finish = null, usage = null;
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
            if (j.error) throw new Error(NAME + ": " + (j.error.message || "error"));
            const u = j.usage || (j.x_groq && j.x_groq.usage);
            if (u) usage = u;
            const ch = j.choices && j.choices[0];
            if (!ch) continue;
            if (ch.delta && ch.delta.content) { text += ch.delta.content; onText && onText(text); }
            if (ch.finish_reason) finish = ch.finish_reason;
          }
        }
        if (usage && opts.onUsage) opts.onUsage({ prompt: usage.prompt_tokens || 0, completion: usage.completion_tokens || 0, total: usage.total_tokens || ((usage.prompt_tokens || 0) + (usage.completion_tokens || 0)) });
        onFinish && onFinish(finish);
        return text.replace(/<think>[\s\S]*?<\/think>/g, "");
      },
    };
  }

  // ------------------------------------------------------------------ prompts
  const SYS = "You are STEJECT's assistant, helping a student understand and ship a coding project. Be accurate, concrete and brief. Never invent files that are not in the project.";

  const prompts = {
    /** Step 1 of an idea: a plan (file tree + commits) the student can edit before any code is written. */
    plan(idea, size) {
      const scale = size === "medium" ? "5 to 9 files" : "3 to 6 files";
      return [
        { role: "system", content: "You plan small, complete, beginner-friendly coding projects for students. Respond with JSON only." },
        { role: "user", content:
`Plan this project: ${String(idea).trim().slice(0, 1200)}

Return JSON exactly like:
{"project":"short-kebab-case-name","summary":"one sentence","commits":[{"message":"Imperative commit message","files":[{"path":"relative/path.ext","purpose":"what this file does, one short line"}]}]}

Rules:
- ${scale} in total, 3 to 5 commits in build order: setup and core first, then features, tests, and README last.
- Include README.md and .gitignore. Add a small test file when the language has a standard test tool.
- Standard library or very common packages only. No API keys, accounts or network services.
- Relative paths, text files only.` },
      ];
    },
    /** Step 2: write exactly the approved plan as a manifest. */
    writePlan(idea, plan, size) {
      const limit = size === "medium" ? 150 : 100;
      const tree = plan.commits.map(c => `${c.message}:\n` + c.files.map(f => `  - ${f.path}${f.purpose ? " — " + f.purpose : ""}`).join("\n")).join("\n");
      return [
        { role: "system", content: "You write complete, working, beginner-friendly projects for students and output them in the STEJECT manifest format. Output ONLY the manifest: no explanations and no markdown fences." },
        { role: "user", content:
`Write this project: ${String(idea).trim().slice(0, 1200)}
${plan.summary ? "Summary: " + plan.summary + "\n" : ""}
The student approved this plan. Write exactly these files, grouped into exactly these commits, in this order:
${tree}

Output format (exactly):
=== PROJECT: ${plan.project} ===
=== FILE: <relative/path> ===
<full file contents>
=== COMMIT: <commit message from the plan> ===

Rules:
- Every file complete and runnable, none longer than ${limit} lines. No placeholders or TODOs.
- README.md says what it is, how to run it and how to test it.
- Use only the standard library or very common packages. No API keys, accounts or network services.
- Never write a line that starts with "=== " inside a file.` },
      ];
    },
    /** Chat to change: returns only the files that change, as new commit(s). */
    change(request, digest) {
      return [
        { role: "system", content: "You change an existing student project. Output ONLY a STEJECT manifest containing the files you add or change: no explanations and no markdown fences." },
        { role: "user", content:
`Make this change: ${String(request).trim().slice(0, 1500)}

Output ONLY the files you add or change, each one complete, then one COMMIT line:
=== FILE: <relative/path> ===
<full new file contents>
=== COMMIT: <imperative commit message for this change> ===
To remove a file write: === DELETE: <path> === before the COMMIT line.
Don't output files that stay the same. Keep the project's style. Update the README or tests if the change needs it.
Never write a line that starts with "=== " inside a file.

THE PROJECT:
${digest}` },
      ];
    },
    /** Self-check loop: the project failed its run or tests; return fixed files only. */
    fixRun(output, digest, kind) {
      return [
        { role: "system", content: "You fix bugs in a student project. Output ONLY a STEJECT manifest with the files you change: no explanations and no markdown fences." },
        { role: "user", content:
`The project failed when STEJECT ${kind === "web" ? "opened it in a browser" : "ran it"}. Fix the cause.

OUTPUT:
${String(output).slice(-4000)}

Output ONLY the files you change, each one complete, then one COMMIT line:
=== FILE: <relative/path> ===
<full fixed file contents>
=== COMMIT: Fix <what was wrong> ===
Fix the code, not the tests, unless a test itself is wrong. Don't output files that stay the same.
Never write a line that starts with "=== " inside a file.

THE PROJECT:
${digest}` },
      ];
    },
    /** Mock interview: one turn. Answer with JSON {feedback, score, question, done}. */
    interview(digest, n) {
      return { role: "system", content:
`You are a friendly but rigorous technical interviewer. The candidate is a student presenting the project below, which they say they built.
Ask ${n} questions in total, one at a time, about THIS code: what parts do, why it was built this way, edge cases, how they would extend or test it.
Every reply is JSON only: {"feedback":"1-2 sentences on the last answer, or empty for the first turn","score":0|1|2|null,"question":"the next question, or empty when finished","done":true|false}
score rates the last answer: 0 wrong or empty, 1 partly right, 2 clear and correct; null on the first turn.
After the candidate answers question ${n}, give feedback and score, set "question" to "" and "done" to true.

THE PROJECT:
${digest}` };
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

  const api = { MODELS, GROQ_MODELS, PRESETS, validBase, ollama, groq, compat, prompts, telegram };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.SteAI = api;
})(typeof self !== "undefined" ? self : this);
