/* STEJECT app controller: wires the UI to core, GitHub, AI and Telegram. */
(() => {
  "use strict";
  const C = window.SteCore, G = window.SteGitHub, AI = window.SteAI;
  const native = window.steNative || null;         // set by the desktop app's preload
  const BUILD = window.STE_BUILD || { version: "dev", repo: "" };
  const inFrame = window.top !== window;

  // ================================================================ helpers
  const $ = id => document.getElementById(id);
  const $$ = sel => [...document.querySelectorAll(sel)];
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

  const store = {
    get(k, d) { try { const v = localStorage.getItem("steject." + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { v === undefined || v === null ? localStorage.removeItem("steject." + k) : localStorage.setItem("steject." + k, JSON.stringify(v)); } catch {} },
    clear() { try { Object.keys(localStorage).filter(k => k.startsWith("steject.")).forEach(k => localStorage.removeItem(k)); } catch {} },
  };
  // secrets: OS-encrypted in the desktop app, browser storage otherwise
  const secrets = {
    async get(k) { if (native) { try { return await native.secrets.get(k); } catch { return null; } } return store.get("secret." + k, null); },
    async set(k, v) { if (native) { try { await native.secrets.set(k, v); return; } catch {} } store.set("secret." + k, v); },
    async del(k) { if (native) { try { await native.secrets.del(k); } catch {} } store.set("secret." + k, null); },
  };

  let toastT;
  function toast(msg) {
    const t = $("toast"); t.textContent = msg; t.hidden = false;
    clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 3200);
  }
  function setStatus(id, text, cls) { const el = $(id); el.className = "status " + (cls || ""); el.textContent = text || ""; }
  async function copyText(text) {
    try { if (native) { await native.copy(text); return true; } await navigator.clipboard.writeText(text); return true; }
    catch { return false; }
  }
  function md(text) {
    const html = window.marked ? window.marked.parse(text, { breaks: false, gfm: true }) : "<pre>" + esc(text) + "</pre>";
    return window.DOMPurify ? window.DOMPurify.sanitize(html) : esc(text);
  }

  // ================================================================ state
  const SAMPLE = [
    "=== PROJECT: hello-app ===",
    "=== FILE: app.py ===",
    "def greet(name):",
    "    return f\"Hello, {name}!\"",
    "",
    "",
    "if __name__ == \"__main__\":",
    "    print(greet(\"world\"))",
    "=== COMMIT: Add main script ===",
    "=== FILE: test_app.py ===",
    "from app import greet",
    "",
    "",
    "def test_greet():",
    "    assert greet(\"Aadvik\") == \"Hello, Aadvik!\"",
    "=== COMMIT: Add tests ===",
    "=== FILE: README.md ===",
    "# hello-app",
    "",
    "Tiny demo project.",
    "",
    "## Run",
    "    python app.py",
    "",
    "## Test",
    "    pytest",
    "=== FILE: .gitignore ===",
    "__pycache__/",
    ".env",
    "=== COMMIT: Add README and gitignore ===",
  ].join("\n");

  const S = {
    m: null, hits: [], error: null, isChat: false,
    selected: null, view: "file",
    mode: store.get("mode", "new"),
    gh: { token: null, login: null },
    repos: [],
    target: null,        // {full, st, remote: Map(path -> text|null), loading}
    ctx: null, lastJob: null,
    busy: false,
    ai: { url: store.get("aiUrl", "http://localhost:11434"), ok: false, models: [], model: store.get("aiModel", null), reason: null },
    provider: store.get("aiProvider", "ollama"),          // "ollama" | "groq"
    groq: { key: "", bad: false, models: [], model: store.get("groqModel", null) },
    undo: null,
  };

  // ---- which AI helper is active (local Ollama or free cloud Groq)
  function aiOn() { return S.provider === "groq" ? !!(S.groq.key && S.groq.model && !S.groq.bad) : !!(S.ai.ok && S.ai.model); }
  function aiModel() { return S.provider === "groq" ? S.groq.model : S.ai.model; }
  function aiLabel() { return S.provider === "groq" ? "Groq" : "your local AI"; }
  function llm() { return S.provider === "groq" ? AI.groq(S.groq.key) : AI.ollama(S.ai.url); }
  function ollama() { return AI.ollama(S.ai.url); }
  // how much text the active helper can rewrite in one go (free cloud has a per-minute token cap)
  function repairLimit() { return S.provider === "groq" ? 12000 : 60000; }

  // ================================================================ navigation
  function go(page, focusId) {
    $$("[data-page]").forEach(p => { p.hidden = p.dataset.page !== page; });
    $$("nav.tabs-main button").forEach(b => b.setAttribute("aria-current", b.dataset.go === page ? "page" : "false"));
    if (location.hash !== "#" + page) history.replaceState(null, "", "#" + page);
    if (page === "learn") renderLearn();
    if (page === "history") renderHistory();
    if (focusId === "groqKey") setProvider("groq");
    else if (focusId === "aiUrl" && S.provider === "groq") focusId = "groqKey";
    if (page === "settings" && S.provider === "ollama" && !S.ai.ok) checkAi();
    window.scrollTo(0, 0);
    if (focusId) setTimeout(() => { const el = $(focusId); if (el && !el.closest("[hidden]")) el.focus(); }, 30);
  }
  document.addEventListener("click", e => {
    const g = e.target.closest("[data-go]");
    if (g) { e.preventDefault(); go(g.dataset.go, g.dataset.focus); }
  });

  // ================================================================ SHIP: paste + parse
  const ta = $("manifest");

  function reparse() {
    const text = ta.value;
    $("sampleTag").hidden = text !== SAMPLE;
    $("replaceBox").hidden = true;
    S.isChat = false;
    if (!text.trim()) { Object.assign(S, { m: null, hits: [], error: null }); }
    else {
      try {
        const m = C.parse(text);
        Object.assign(S, { m, hits: C.scanSecrets(m), error: null });
      } catch (e) {
        Object.assign(S, { m: null, hits: [], error: e instanceof C.ManifestError ? e.message : "Could not read this: " + e.message });
        S.isChat = !C.looksLikeManifest(text) && /```/.test(text);
      }
    }
    if (S.m && S.ctx && S.ctx.manifestText !== text) S.ctx = null; // manifest changed: can't resume
    render();
    store.set("draft", text.length < 400000 ? text : null);
  }

  function chk(k, v, cls) { return `<div class="chk ${cls || ""}"><span class="k">${k}</span><span class="v">${v}</span></div>`; }

  function fileStatus(path, content) {
    const t = S.target;
    if (S.mode !== "update" || !t || !t.remote) return null;
    if (content === null) return t.st && t.st.paths.has(path) ? "del" : "same";
    if (!t.remote.has(path)) return t.loading ? null : "new";
    const r = t.remote.get(path);
    if (r === null) return "new";
    return r === content ? "same" : "chg";
  }

  function render() {
    const { m, hits, error } = S;
    $("convertBox").hidden = !(error && S.isChat);
    $("fixBox").hidden = !(error && !S.isChat && ta.value.trim());
    const aiReady = aiOn();
    $("fixAiBtn").disabled = !aiReady;
    const hint = error && !S.isChat ? C.pasteHint(ta.value) : null;
    $("fixText").textContent = hint
      ? hint + (aiReady ? " Or let the AI try to repair it." : "")
      : aiReady ? "The format is broken. Your AI helper can try to repair it."
      : "The format is broken. Ask the chat AI to resend it using the STEJECT prompt, or set up an AI helper in Settings to repair it here.";
    $("aiTools").hidden = !(m && aiReady);
    $("ideaNoAi").hidden = aiReady;
    $("ideaGo").disabled = !aiReady || !!aiAbort;

    const errs = $("errors"), checks = $("checks"), list = $("commits");
    errs.innerHTML = "";
    if (!m) {
      checks.innerHTML = chk("Format", error ? "Not readable" : "Waiting", error ? "bad" : "") + chk("Secret scan", "Waiting") + chk("Commits", "0");
      if (error && !S.isChat) errs.innerHTML = `<div class="err">${esc(error)}</div>`;
      list.innerHTML = error ? "" : `<li class="empty">Paste a manifest to see the commit plan.</li>`;
      $("projName").textContent = "";
      showFile(null);
      updateShip();
      return;
    }
    const st = C.stats(m);
    let cmp = "";
    if (S.mode === "update" && S.target && S.target.remote && !S.target.loading) {
      let n = 0, c = 0, d = 0;
      C.finalFiles(m).forEach((v, p) => { const s = fileStatus(p, v); if (s === "new") n++; else if (s === "chg") c++; });
      m.commits.forEach(cm => cm.files.forEach((v, p) => { if (v === null && fileStatus(p, v) === "del") d++; }));
      cmp = chk("vs GitHub", `${n} new · ${c} changed${d ? " · " + d + " deleted" : ""}`, "info");
    }
    checks.innerHTML =
      chk("Format", "Valid", "ok") + chk("Paths", "Safe", "ok") +
      (hits.length ? chk("Secret scan", `${hits.length} flagged`, "bad") : chk("Secret scan", "Clean", "ok")) +
      chk("Commits", st.commits) + chk("Files · lines", `${st.files} · ${st.lines}`) + cmp;
    if (hits.length) errs.innerHTML = hits.map(h => `<div class="err">Possible ${esc(h.name)} in ${esc(h.path)}, line ${h.line}</div>`).join("");
    $("projName").innerHTML = `<span class="tag">${esc(m.project)}/</span>`;
    const flagged = new Set(hits.map(h => h.path));
    const badge = s => s ? `<span class="badge ${s}">${{ new: "new", chg: "changed", same: "same", del: "delete" }[s]}</span>` : "";
    list.innerHTML = m.commits.map((c, ci) => {
      const files = [...c.files.entries()].map(([p, v]) => {
        const n = v ? v.split("\n").length - 1 : 0;
        const cls = [flagged.has(p) ? "flag" : "", v === null ? "del" : ""].join(" ");
        return `<li><button type="button" data-path="${esc(p)}" class="${cls}"><span class="p">${esc(p)}</span><span class="c">${badge(fileStatus(p, v))}${v === null ? "" : n}</span></button></li>`;
      }).join("");
      return `<li class="commit"><div class="msg">${esc(c.message)}</div><div class="meta">commit ${ci + 1} of ${m.commits.length} · ${plural(c.files.size, "file")}</div><ul class="files">${files}</ul></li>`;
    }).join("");
    let sel = S.selected && findFile(S.selected) !== undefined ? S.selected : null;
    if (!sel) sel = hits[0] ? hits[0].path : [...m.commits[0].files.keys()][0];
    showFile(sel);
    updateShip();
  }

  // last version of a path in the manifest (undefined if not present)
  function findFile(path) {
    if (!S.m) return undefined;
    let out;
    S.m.commits.forEach(c => { if (c.files.has(path)) out = c.files.get(path); });
    return out;
  }

  function showFile(path) {
    const code = $("code");
    $$(".files button").forEach(b => b.setAttribute("aria-current", b.dataset.path === path ? "true" : "false"));
    if (!path) {
      S.selected = null;
      $("vPath").textContent = "No file selected"; $("vMeta").textContent = ""; $("vTabs").hidden = true;
      code.innerHTML = `<div class="empty">Pick a file from the commit plan to read it.</div>`;
      return;
    }
    S.selected = path;
    const content = findFile(path);
    const status = fileStatus(path, content === undefined ? null : content);
    const canDiff = status === "chg" || status === "del" || status === "new";
    $("vTabs").hidden = !canDiff;
    if (!canDiff && S.view === "diff") S.view = "file";
    $("vFile").setAttribute("aria-pressed", S.view === "file");
    $("vDiff").setAttribute("aria-pressed", S.view === "diff");
    $("vPath").textContent = path;

    if (S.view === "diff" && canDiff) {
      const before = S.target.remote.get(path) || "";
      const after = content || "";
      const ops = C.diffLines(before, after);
      const sum = C.diffSummary(ops);
      $("vMeta").textContent = `+${sum.add} −${sum.del}`;
      code.innerHTML = renderDiff(ops);
      return;
    }
    if (content === null) {
      $("vMeta").textContent = "deleted";
      code.innerHTML = `<div class="empty">This commit deletes ${esc(path)}.</div>`;
      return;
    }
    const lines = (content || "").replace(/\n$/, "").split("\n");
    const hitLines = new Set(S.hits.filter(h => h.path === path).map(h => h.line));
    $("vMeta").textContent = content ? `${lines.length} lines · ${new Blob([content]).size} B` : "empty file";
    if (!content) { code.innerHTML = `<div class="empty">This file is empty.</div>`; return; }
    const shown = lines.length > 4000 ? lines.slice(0, 4000) : lines;
    code.innerHTML = `<table>${shown.map((l, i) => `<tr class="${hitLines.has(i + 1) ? "hit" : ""}"><td class="ln">${i + 1}</td><td class="tx">${esc(l) || " "}</td></tr>`).join("")}</table>` +
      (lines.length > shown.length ? `<div class="empty">Showing the first 4,000 of ${lines.length} lines.</div>` : "");
  }

  function renderDiff(ops) {
    if (ops.length === 1 && ops[0].t === "!") return `<div class="empty">${esc(ops[0].s)}</div>`;
    const keep = new Array(ops.length).fill(false);
    ops.forEach((o, i) => { if (o.t !== " ") for (let k = Math.max(0, i - 3); k <= Math.min(ops.length - 1, i + 3); k++) keep[k] = true; });
    let a = 0, b = 0, out = "", gap = false;
    ops.forEach((o, i) => {
      if (o.t !== "+") a++;
      if (o.t !== "-") b++;
      if (!keep[i]) { if (!gap) { out += `<tr class="gap"><td class="ln"></td><td class="ln"></td><td class="sg"></td><td class="tx">⋯ unchanged lines</td></tr>`; gap = true; } return; }
      gap = false;
      const cls = o.t === "+" ? "add" : o.t === "-" ? "rem" : "";
      out += `<tr class="${cls}"><td class="ln">${o.t === "+" ? "" : a}</td><td class="ln">${o.t === "-" ? "" : b}</td><td class="sg">${o.t === " " ? "" : o.t === "-" ? "−" : "+"}</td><td class="tx">${esc(o.s) || " "}</td></tr>`;
    });
    if (!ops.some(o => o.t !== " ")) return `<div class="empty">No changes.</div>`;
    return `<table>${out}</table>`;
  }

  function setText(text, keepUndo) {
    if (keepUndo) { S.undo = ta.value; $("undoBtn").hidden = false; }
    ta.value = text;
    setStatus("aiToolMsg", "");
    reparse();
  }

  // ---------- converter / AI repair / AI tools
  $("convertBtn").addEventListener("click", () => {
    try {
      const r = C.convertChatReply(ta.value);
      setText(r.text, true);
      toast(`Converted ${plural(r.files.length, "file")}${r.skipped ? `, skipped ${plural(r.skipped, "code block")} with no file name` : ""}. Check the commit plan.`);
    } catch (e) {
      $("convertBox").hidden = true;
      Object.assign(S, { isChat: false });
      $("fixBox").hidden = false;
      $("fixText").textContent = e.message + (aiOn() ? " Your AI helper can try instead." : "");
    }
  });

  let aiAbort = null;
  async function aiRun(fn, onStop) {
    if (aiAbort) aiAbort.abort();
    aiAbort = new AbortController();
    const ctrl = aiAbort;
    try { return await fn(ctrl.signal); }
    finally { if (aiAbort === ctrl) aiAbort = null; onStop && onStop(); }
  }
  const waitNote = (id) => sec => setStatus(id, `Groq's free limit needs a short pause. Continuing in ${sec}s…`, "info");

  $("fixAiBtn").addEventListener("click", async () => {
    const raw = ta.value;
    if (raw.length > repairLimit()) { $("fixText").textContent = `This is too long for ${aiLabel()} to repair in one go. Ask the chat AI to resend it in the STEJECT format.`; return; }
    $("fixAiBtn").disabled = true; $("fixCancel").hidden = false; $("fixProg").hidden = false;
    const bar = $("fixProg").firstElementChild;
    $("fixText").textContent = `${S.provider === "groq" ? "Groq is" : "Your local AI is"} rewriting it. This can take a minute…`;
    try {
      const out = await aiRun(signal => llm().chat(aiModel(), AI.prompts.fixManifest(raw), {
        signal, temperature: 0, ctx: 16384, maxTokens: Math.min(16000, Math.ceil(raw.length / 3) + 800), onWait: waitNote("fixText"),
        onText: t => { bar.style.width = Math.min(98, Math.round(t.length / raw.length * 100)) + "%"; },
      }), () => { $("fixCancel").hidden = true; $("fixProg").hidden = true; bar.style.width = "0"; });
      let text = out.trim().replace(/^```[a-z]*\n?/i, "").replace(/\n?```\s*$/, "");
      C.parse(text); // throws if still broken
      setText(text, true);
      toast("Repaired. Check every file before pushing: small models can make mistakes.");
    } catch (e) {
      if (e.name === "AbortError") { $("fixText").textContent = "Stopped."; }
      else $("fixText").textContent = "The AI couldn't repair it: " + e.message;
    } finally { $("fixAiBtn").disabled = !aiOn(); }
  });
  $("fixCancel").addEventListener("click", () => aiAbort && aiAbort.abort());

  $("aiReadme").addEventListener("click", async () => {
    if (!S.m) return;
    setStatus("aiToolMsg", "Writing README…", "info");
    $("aiReadme").disabled = $("aiPlan").disabled = true;
    try {
      const out = await aiRun(signal => llm().chat(aiModel(), AI.prompts.readme(C.digest(S.m, 10000)), { signal, temperature: 0.3, maxTokens: 3000, onWait: waitNote("aiToolMsg") }));
      const readme = out.trim().replace(/^```(?:markdown|md)?\n/i, "").replace(/\n```\s*$/, "") + "\n";
      const exists = C.finalFiles(S.m).has("README.md");
      const m2 = { project: S.m.project, commits: [...S.m.commits, { message: exists ? "Update README" : "Add README", files: new Map([["README.md", readme]]) }] };
      setText(C.serialize(m2), true);
      S.selected = "README.md"; showFile("README.md");
      setStatus("aiToolMsg", "README added as the last commit. Review it before pushing.", "ok");
    } catch (e) { setStatus("aiToolMsg", e.name === "AbortError" ? "Stopped." : e.message, "bad"); }
    finally { $("aiReadme").disabled = $("aiPlan").disabled = false; }
  });

  $("aiPlan").addEventListener("click", async () => {
    if (!S.m) return;
    if (S.m.commits.some(c => [...c.files.values()].some(v => v === null))) { setStatus("aiToolMsg", "Re-planning isn't available when the manifest deletes files.", "bad"); return; }
    setStatus("aiToolMsg", "Planning commits…", "info");
    $("aiReadme").disabled = $("aiPlan").disabled = true;
    try {
      const files = C.finalFiles(S.m);
      const out = await aiRun(signal => llm().chat(aiModel(), AI.prompts.commitPlan(C.digest(S.m, 6000)), { signal, json: true, temperature: 0.1, maxTokens: 2000, onWait: waitNote("aiToolMsg") }));
      const plan = C.extractJson(out).commits;
      if (!Array.isArray(plan) || !plan.length) throw new Error("The model returned an empty plan.");
      const used = new Set(), commits = [];
      plan.forEach(c => {
        const fm = new Map();
        (c.files || []).forEach(p => { if (files.has(p) && !used.has(p)) { fm.set(p, files.get(p)); used.add(p); } });
        if (fm.size) commits.push({ message: String(c.message || "Add files").slice(0, 120), files: fm });
      });
      const left = [...files.keys()].filter(p => !used.has(p));
      if (left.length) commits.push({ message: "Add remaining files", files: new Map(left.map(p => [p, files.get(p)])) });
      setText(C.serialize({ project: S.m.project, commits }), true);
      setStatus("aiToolMsg", `New plan: ${plural(commits.length, "commit")}. Undo if you preferred the old one.`, "ok");
    } catch (e) { setStatus("aiToolMsg", e.name === "AbortError" ? "Stopped." : "Couldn't re-plan: " + e.message, "bad"); }
    finally { $("aiReadme").disabled = $("aiPlan").disabled = false; }
  });

  // ---------- paste-area events
  let pT;
  ta.addEventListener("input", () => { clearTimeout(pT); pT = setTimeout(reparse, 160); $("undoBtn").hidden = true; if (!S.ctx) clearRun(); });
  $("loadSample").addEventListener("click", () => setText(SAMPLE, ta.value.trim() && ta.value !== SAMPLE));
  $("clearBtn").addEventListener("click", () => { setText("", !!ta.value.trim()); ta.focus(); });
  $("undoBtn").addEventListener("click", () => { if (S.undo != null) { ta.value = S.undo; S.undo = null; $("undoBtn").hidden = true; reparse(); } });
  function readFileInto(f) {
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) { toast("That file is over 5 MB. Is it really a manifest?"); return; }
    const r = new FileReader();
    r.onload = () => setText(String(r.result), !!ta.value.trim());
    r.readAsText(f);
  }
  $("fileIn").addEventListener("change", e => { readFileInto(e.target.files[0]); e.target.value = ""; });
  ta.addEventListener("dragover", e => { e.preventDefault(); ta.classList.add("drop"); });
  ta.addEventListener("dragleave", () => ta.classList.remove("drop"));
  ta.addEventListener("drop", e => { if (e.dataTransfer.files.length) { e.preventDefault(); readFileInto(e.dataTransfer.files[0]); } ta.classList.remove("drop"); });

  $("commits").addEventListener("click", e => { const b = e.target.closest("button[data-path]"); if (b) showFile(b.dataset.path); });
  $("vFile").addEventListener("click", () => { S.view = "file"; showFile(S.selected); });
  $("vDiff").addEventListener("click", () => { S.view = "diff"; showFile(S.selected); });

  // prompt templates
  let tplKind = "new";
  function showTpl() {
    $("tplText").textContent = tplKind === "new" ? C.PROMPT_TEMPLATE : C.UPDATE_PROMPT;
    $("tplNew").setAttribute("aria-pressed", tplKind === "new"); $("tplUpd").setAttribute("aria-pressed", tplKind === "upd");
  }
  $("tplNew").addEventListener("click", () => { tplKind = "new"; showTpl(); });
  $("tplUpd").addEventListener("click", () => { tplKind = "upd"; showTpl(); });
  $("copyTpl").addEventListener("click", async () => {
    const ok = await copyText($("tplText").textContent);
    if (ok) toast("Prompt copied. Paste it into ChatGPT or Claude.");
    else { const r = document.createRange(); r.selectNodeContents($("tplText")); const s = getSelection(); s.removeAllRanges(); s.addRange(r); toast("Press Ctrl+C to copy the selected prompt."); }
  });

  // ================================================================ SHIP: push
  const canShip = () => !!S.m && (!S.hits.length || $("override").checked) && !S.busy;

  function setMode(mode) {
    S.mode = mode; store.set("mode", mode);
    $("modeNew").setAttribute("aria-pressed", mode === "new");
    $("modeUpd").setAttribute("aria-pressed", mode === "update");
    $("modeKit").setAttribute("aria-pressed", mode === "kit");
    $("paneGh").hidden = mode === "kit";
    $("paneKit").hidden = mode !== "kit";
    $("newFields").hidden = mode !== "new";
    $("updFields").hidden = mode !== "update";
    $("replaceBox").hidden = true;
    clearRun();
    if (mode === "update") { if (!S.repos.length) loadRepos(); else compareTarget(); }
    render();
  }
  $("modeNew").addEventListener("click", () => setMode("new"));
  $("modeUpd").addEventListener("click", () => setMode("update"));
  $("modeKit").addEventListener("click", () => setMode("kit"));

  function clearRun() { if (S.busy) return; $("log").hidden = true; $("doneBox").hidden = true; }

  let lastProject = null;
  function updateShip() {
    $("overrideRow").hidden = !(S.m && S.hits.length);
    if (!S.hits.length) $("override").checked = false;
    if (S.m && S.m.project !== lastProject) {
      if (!$("repoName").dataset.touched) $("repoName").value = S.m.project;
      lastProject = S.m.project;
    }
    const ok = canShip();
    const n = S.m ? S.m.commits.length : 0;
    const connected = !!S.gh.login;
    $("acctBox").className = "acct" + (connected ? "" : " off");
    $("acctText").textContent = connected ? `✓ Pushing as @${S.gh.login}` : "GitHub is not connected.";
    $("acctBtn").textContent = connected ? "Change" : "Connect";

    const pick = $("repoPick").value;
    let label = "Push to GitHub";
    if (S.m) label = S.mode === "update" ? (pick ? `Add ${plural(n, "commit")} to ${pick.split("/")[1]}` : "Pick a repo first") : `Push ${plural(n, "commit")} to GitHub`;
    $("pushBtn").textContent = label;
    $("pushBtn").disabled = !ok || !connected || (S.mode === "update" && (!pick || (S.target && S.target.loading)));
    $("resumeBtn").hidden = !(S.ctx && S.ctx.next < (S.m ? S.m.commits.length : 0) && S.mode !== "kit");
    $("resumeBtn").disabled = S.busy || !connected;
    $("dlBtn").disabled = !ok || !window.JSZip;
    $("copyScript").disabled = !ok;

    if (!S.m) setStatus("shipMsg", ta.value.trim() ? "" : "Paste a manifest to start.");
    else if (S.hits.length && !$("override").checked) setStatus("shipMsg", "Blocked: possible secrets found. Remove them, or confirm they are safe.", "bad");
    else if (!connected && S.mode !== "kit") setStatus("shipMsg", "Connect GitHub in Settings to push.", "");
    else if (!$("shipMsg").dataset.keep) setStatus("shipMsg", "");

    const tgOn = $("tgOn").checked && $("tgToken").value.trim() && $("tgChat").value.trim();
    $("tgLine").innerHTML = tgOn ? "Telegram alert: on" : `Telegram alert: off · <button type="button" class="link" data-go="settings" data-focus="tgToken">Set up</button>`;
  }
  $("override").addEventListener("change", updateShip);
  $("repoName").addEventListener("input", e => { e.target.dataset.touched = e.target.value ? "1" : ""; });

  function makeLog() {
    const ul = $("log");
    ul.innerHTML = ""; ul.hidden = false;
    const icons = { run: "…", ok: "✓", bad: "✗", skip: "·" };
    const items = {};
    const set = (id, cls, text) => {
      let li = items[id];
      if (!li) { li = document.createElement("li"); items[id] = li; ul.appendChild(li); }
      li.className = cls; li.innerHTML = `<span>${icons[cls]}</span><span>${esc(text)}</span>`;
      ul.scrollTop = ul.scrollHeight;
    };
    return { run: (id, t) => set(id, "run", t), update: (id, cls, t) => set(id, cls, t), fail: t => set("f" + Math.random(), "bad", t) };
  }

  async function notify(text) {
    const t = $("tgToken").value.trim(), c = $("tgChat").value.trim();
    if (!$("tgOn").checked || !t || !c) return "off";
    try { await AI.telegram(t, "sendMessage", { chat_id: c, text, disable_web_page_preview: "true" }); return "sent"; }
    catch { return "failed"; }
  }

  async function doPush({ allowReplace = false, resume = false } = {}) {
    if (!S.m || S.busy) return;
    if (!resume && !canShip()) return;
    if (!S.gh.token) { go("settings", "ghToken"); return; }
    $("replaceBox").hidden = true; $("doneBox").hidden = true;
    const m = S.m, manifestText = ta.value;
    let job;
    if (resume && S.ctx) job = { ...S.lastJob, ctx: S.ctx };
    else if (S.mode === "update") {
      const full = $("repoPick").value;
      if (!full) return;
      job = { mode: "update", full };
    } else {
      const name = $("repoName").value.trim();
      if (!/^[A-Za-z0-9._-]{1,100}$/.test(name) || /^\.+$/.test(name)) { setStatus("shipMsg", "Repo name can use letters, numbers, - _ . only.", "bad"); return; }
      job = { mode: "new", name, description: $("repoDesc").value.trim(), isPrivate: document.querySelector('input[name="vis"]:checked').value === "private" };
    }
    S.lastJob = { ...job, ctx: undefined };
    S.busy = true; updateShip();
    const log = makeLog();
    try {
      const r = await G.ship({
        ...job, token: S.gh.token, login: S.gh.login, manifest: m, allowReplace, log,
        onCtx: ctx => { ctx.manifestText = manifestText; S.ctx = ctx; },
      });
      if (r.status === "confirm") {
        $("replaceText").textContent = `${r.full} already has one commit ("${r.existing}"). STEJECT will replace it with your ${plural(m.commits.length, "commit")}.`;
        $("replaceBox").hidden = false;
        S.ctx = null;
        return;
      }
      S.ctx = null;
      if (r.nothing) {
        log.update("ref", "skip", "Everything already matches GitHub. Nothing to push.");
        return;
      }
      log.run("tg", "Telegram alert");
      const tg = await notify(`✅ STEJECT ${job.mode === "update" ? "updated" : "shipped"} ${r.full}\n${plural(r.commits, "commit")}\n${r.url}`);
      log.update("tg", tg === "sent" ? "ok" : "skip", tg === "sent" ? "Telegram alert sent" : tg === "failed" ? "Telegram alert failed. Check the bot settings." : "Telegram alert off");
      $("doneBox").innerHTML = `<span>${job.mode === "update" ? "Updated." : "Shipped."}</span><a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.url.replace(/^https:\/\//, ""))}</a>`;
      $("doneBox").hidden = false;
      addHistory({ full: r.full, url: r.url, commits: r.commits, mode: job.mode, project: m.project, files: C.stats(m).files, at: Date.now() });
      if (job.mode === "update") { S.target = null; compareTarget(); }
      else { S.repos = []; }
    } catch (e) {
      log.fail(e.message || String(e));
      if (S.ctx && S.ctx.next > 0) log.update("hint", "skip", `Stopped after ${S.ctx.next} of ${m.commits.length} commits. Nothing on GitHub changed yet. Click Resume push to continue.`);
      if (e.status === 401) { await setGh(null, null); }
      notify(`❌ STEJECT failed for ${job.full || job.name}: ${(e.message || "").slice(0, 200)}`);
    } finally {
      S.busy = false; updateShip();
    }
  }
  $("pushBtn").addEventListener("click", () => doPush());
  $("resumeBtn").addEventListener("click", () => doPush({ resume: true }));
  $("replaceYes").addEventListener("click", () => doPush({ allowReplace: true }));
  $("replaceNo").addEventListener("click", () => { $("replaceBox").hidden = true; toast("Cancelled. Nothing changed on GitHub."); });

  // ---------- update mode: repo list + comparison
  async function loadRepos() {
    const sel = $("repoPick");
    if (!S.gh.token) { sel.innerHTML = `<option value="">Connect GitHub to see your repos</option>`; updateShip(); return; }
    setStatus("cmpMsg", "Loading your repos…", "info");
    try {
      S.repos = await G.listRepos(S.gh.token);
      const prev = sel.value || store.get("lastRepo", "");
      sel.innerHTML = `<option value="">Pick a repository…</option>` + S.repos.map(r => `<option value="${esc(r.full)}">${esc(r.full)}${r.private ? " (private)" : ""}</option>`).join("");
      if (S.repos.some(r => r.full === prev)) sel.value = prev;
      else if (S.m) { const match = S.repos.find(r => r.name.toLowerCase() === S.m.project.toLowerCase()); if (match) sel.value = match.full; }
      setStatus("cmpMsg", S.repos.length ? "" : "You don't have any repos yet. Use New repo.");
      compareTarget();
    } catch (e) { setStatus("cmpMsg", e.message, "bad"); }
    updateShip();
  }
  $("repoRefresh").addEventListener("click", loadRepos);
  $("repoPick").addEventListener("change", () => { store.set("lastRepo", $("repoPick").value); S.target = null; S.ctx = null; clearRun(); compareTarget(); });

  let cmpSeq = 0;
  async function compareTarget() {
    const full = $("repoPick").value;
    if (S.mode !== "update" || !full || !S.gh.token) { if (!full) S.target = null; render(); return; }
    const seq = ++cmpSeq;
    if (!S.target || S.target.full !== full) S.target = { full, st: null, remote: new Map(), loading: true };
    S.target.loading = true;
    setStatus("cmpMsg", "Comparing with GitHub…", "info");
    render();
    try {
      const st = await G.repoState(S.gh.token, full);
      if (seq !== cmpSeq) return;
      if (!st) throw new Error("Can't open this repo.");
      S.target.st = st;
      if (S.m) {
        const want = [...C.finalFiles(S.m).keys()].filter(p => !S.target.remote.has(p));
        const queue = want.slice(0, 80);
        await Promise.all(Array.from({ length: 6 }, async () => {
          while (queue.length) {
            const p = queue.shift();
            const txt = st.paths.has(p) ? await G.readFile(S.gh.token, full, p, st.branch) : null;
            if (seq !== cmpSeq) return;
            S.target.remote.set(p, txt);
          }
        }));
      }
      if (seq !== cmpSeq) return;
      S.target.loading = false;
      setStatus("cmpMsg", st.head ? `${full} has ${plural(st.paths.size, "file")} on ${st.branch}.` : `${full} is empty.`, "");
    } catch (e) {
      if (seq !== cmpSeq) return;
      S.target.loading = false; S.target.remote = null;
      setStatus("cmpMsg", e.message, "bad");
    }
    render();
  }

  // ---------- ship kit
  const kitOpts = () => ({ remote: $("remote").value.trim(), tgToken: $("tgOn").checked ? $("tgToken").value.trim() : "", tgChat: $("tgOn").checked ? $("tgChat").value.trim() : "" });
  $("copyScript").addEventListener("click", async () => {
    if (!canShip()) return;
    const ok = await copyText(C.buildScript(S.m, kitOpts()));
    toast(ok ? "ship.sh copied. Save it as ship.sh and run: bash ship.sh" : "Copy is blocked here. Use Download ship kit instead.");
  });
  async function saveFile(name, blob) {
    if (native) return native.saveFile(name, new Uint8Array(await blob.arrayBuffer()));
    const dl = window.claude && typeof window.claude.use === "function" ? await window.claude.use("downloads").catch(() => null) : null;
    if (dl) { await dl.save({ filename: name, data: blob }); return true; }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    return true;
  }
  $("dlBtn").addEventListener("click", async () => {
    if (!canShip()) return;
    const m = S.m, o = kitOpts();
    if (o.remote && !/^(https:\/\/|git@|ssh:\/\/)/.test(o.remote)) { setStatus("shipMsg", "The repo URL should start with https:// or git@", "bad"); return; }
    const zip = new JSZip();
    zip.file("ship.sh", C.buildScript(m, o), { unixPermissions: "755" });
    zip.file("README.txt", [
      `STEJECT ship kit: ${m.project}`, "",
      "1. Open a terminal in this folder (Windows: right-click > Open Git Bash here).",
      "2. Run:  bash ship.sh",
      o.remote ? `   It pushes to ${o.remote}` : "   To push as well, run:  bash ship.sh https://github.com/you/repo.git", "",
      `It creates ./${m.project} with ${plural(m.commits.length, "commit")}:`,
      ...m.commits.map((c, i) => `  ${i + 1}. ${c.message}`), "",
      o.tgToken ? "ship.sh contains your Telegram bot token. Delete this kit after shipping." : "", "",
    ].join("\n"));
    const blob = await zip.generateAsync({ type: "blob", platform: "UNIX" });
    try {
      const ok = await saveFile(`${m.project}-shipkit.zip`, blob);
      if (ok !== false) toast(`Saved ${m.project}-shipkit.zip`);
    } catch (e) {
      toast(e && e.code === "declined" ? "Download cancelled." : "Couldn't save the file. Use Copy ship.sh instead.");
    }
  });

  // ================================================================ LEARN
  let learnSel = null, learnText = "";
  function renderLearn() {
    const aiReady = aiOn();
    $("learnNoAi").hidden = !!aiReady;
    $("learnNoProj").hidden = !!S.m;
    $("learnBody").hidden = !S.m;
    if (!S.m) return;
    const files = [...C.finalFiles(S.m).keys()];
    if (!learnSel || !files.includes(learnSel)) learnSel = files.find(p => C.classify(p) === "code") || files[0];
    $("learnProj").textContent = `${S.m.project} · ${plural(files.length, "file")}`;
    $("learnFiles").innerHTML = files.map(p => `<li><button type="button" data-lp="${esc(p)}" aria-current="${p === learnSel}">${esc(p)}</button></li>`).join("");
    ["lExplain", "lQuiz", "lResume"].forEach(id => { $(id).disabled = !aiReady || !!aiAbort; });
    $("lExplain").textContent = `Explain ${learnSel ? learnSel.split("/").pop() : "this file"}`;
  }
  $("learnFiles").addEventListener("click", e => { const b = e.target.closest("[data-lp]"); if (b) { learnSel = b.dataset.lp; renderLearn(); } });

  function learnBusy(on) {
    $("lStop").hidden = !on;
    ["lExplain", "lQuiz", "lResume"].forEach(id => { $(id).disabled = on || !aiOn(); });
  }
  async function streamTo(title, messages, opts) {
    $("learnTitle").textContent = title; $("lCopy").hidden = true;
    const out = $("learnOut");
    out.innerHTML = `<p class="thinking">${S.provider === "groq" ? "Thinking…" : "Thinking… the first answer can take a moment while the model loads."}</p>`;
    learnBusy(true);
    let raf = 0;
    try {
      learnText = await aiRun(signal => llm().chat(aiModel(), messages, {
        signal, maxTokens: 2500, onWait: sec => { out.innerHTML = `<p class="thinking">Groq's free limit needs a short pause. Continuing in ${sec}s…</p>`; }, ...opts,
        onText: t => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; out.innerHTML = `<div class="prose">${md(t)}</div>`; }); },
      }));
      cancelAnimationFrame(raf);
      out.innerHTML = `<div class="prose">${md(learnText)}</div>`;
      $("lCopy").hidden = false;
    } catch (e) {
      cancelAnimationFrame(raf);
      out.innerHTML = `<div class="callout bad">${esc(e.name === "AbortError" ? "Stopped." : e.message)}</div>`;
    } finally { learnBusy(false); }
  }
  $("lExplain").addEventListener("click", () => {
    if (!S.m || !learnSel) return;
    const content = C.finalFiles(S.m).get(learnSel) || "";
    streamTo(`Explaining ${learnSel}`, AI.prompts.explain(learnSel, content, C.digest(S.m, 3000)), { temperature: 0.3 });
  });
  $("lResume").addEventListener("click", () => { if (S.m) streamTo("Resume bullets", AI.prompts.resume(C.digest(S.m, 8000)), { temperature: 0.4 }); });
  $("lStop").addEventListener("click", () => aiAbort && aiAbort.abort());
  $("lCopy").addEventListener("click", async () => { toast((await copyText(learnText)) ? "Copied." : "Couldn't copy."); });

  $("lQuiz").addEventListener("click", async () => {
    if (!S.m) return;
    $("learnTitle").textContent = "Quiz"; $("lCopy").hidden = true;
    const out = $("learnOut");
    out.innerHTML = `<p class="thinking">Writing 5 questions about your code…</p>`;
    learnBusy(true);
    try {
      const raw = await aiRun(signal => llm().chat(aiModel(), AI.prompts.quiz(C.digest(S.m, 9000), 5), { signal, json: true, temperature: 0.4, maxTokens: 2500, onWait: sec => { out.innerHTML = `<p class="thinking">Groq's free limit needs a short pause. Continuing in ${sec}s…</p>`; } }));
      let qs = C.extractJson(raw);
      qs = (Array.isArray(qs) ? qs : qs.questions || []).filter(q => q && q.q && Array.isArray(q.options) && q.options.length >= 2 && Number.isInteger(+q.answer) && +q.answer < q.options.length).slice(0, 5);
      if (!qs.length) throw new Error("The model didn't return usable questions. Try again, or pick a bigger model in Settings.");
      let answered = 0, right = 0;
      out.innerHTML = `<div class="quiz">${qs.map((q, i) => `
        <div class="q" data-q="${i}">
          <span class="qf">Question ${i + 1} of ${qs.length}${q.file ? " · " + esc(q.file) : ""}</span>
          <span class="qt">${esc(q.q)}</span>
          <div class="opts">${q.options.map((o, j) => `<button type="button" data-o="${j}">${esc(String(o))}</button>`).join("")}</div>
          <span class="why" hidden>${esc(q.why || "")}</span>
        </div>`).join("")}<div class="row" id="quizScore" hidden></div></div>`;
      out.querySelectorAll(".q").forEach(el => el.addEventListener("click", e => {
        const b = e.target.closest("button[data-o]"); if (!b) return;
        const q = qs[+el.dataset.q], pick = +b.dataset.o, ans = +q.answer;
        el.querySelectorAll("button").forEach((x, j) => { x.disabled = true; if (j === ans) x.classList.add("right"); else if (j === pick) x.classList.add("wrong"); });
        el.querySelector(".why").hidden = !q.why;
        answered++; if (pick === ans) right++;
        if (answered === qs.length) {
          const sc = $("quizScore"); sc.hidden = false;
          sc.innerHTML = `<span class="score">${right}/${qs.length}</span><span class="note">${right === qs.length ? "You know this project." : "Use Explain on the files you missed."}</span>`;
        }
      }));
    } catch (e) {
      out.innerHTML = `<div class="callout bad">${esc(e.name === "AbortError" ? "Stopped." : e.message)}</div>`;
    } finally { learnBusy(false); }
  });

  // ================================================================ HISTORY
  function addHistory(entry) {
    const h = store.get("history", []);
    h.unshift(entry);
    store.set("history", h.slice(0, 200));
  }
  function renderHistory() {
    const h = store.get("history", []);
    $("histEmpty").hidden = h.length > 0;
    $("histClear").hidden = !h.length;
    $("histTable").innerHTML = h.length ? `<thead><tr><th>When</th><th>Repo</th><th>Type</th><th>Commits</th><th>Files</th></tr></thead><tbody>${h.map(e => `
      <tr><td class="num">${esc(new Date(e.at).toLocaleString())}</td>
      <td><a href="${esc(e.url)}" target="_blank" rel="noopener">${esc(e.full)}</a></td>
      <td>${e.mode === "update" ? "Update" : "New"}</td><td class="num">${e.commits}</td><td class="num">${e.files ?? ""}</td></tr>`).join("")}</tbody>` : "";
  }
  $("histClear").addEventListener("click", () => { store.set("history", null); renderHistory(); toast("History cleared."); });

  // ================================================================ SETTINGS: GitHub
  async function setGh(token, login) {
    S.gh = { token, login };
    $("ghOut").hidden = !!login; $("ghIn").hidden = !login;
    $("ghLogin").textContent = login ? "@" + login : "";
    const chip = $("chipGh");
    chip.textContent = login ? "@" + login : "GitHub: off";
    chip.classList.toggle("on", !!login);
    if (!login) { S.repos = []; S.target = null; await secrets.del("ghToken"); }
    updateShip();
    if (login && S.mode === "update") loadRepos();
  }
  async function connect(token, quiet) {
    token = (token || "").trim();
    if (!token) { setStatus("ghMsg", "Paste a token first.", "bad"); return false; }
    setStatus("ghMsg", "Checking token…", "info");
    try {
      const me = await G.me(token);
      if ($("ghRemember").checked) await secrets.set("ghToken", token);
      await setGh(token, me.login);
      $("ghToken").value = "";
      setStatus("ghMsg", "");
      if (!quiet) toast(`Connected as @${me.login}`);
      return true;
    } catch (e) {
      setStatus("ghMsg", quiet ? "Your saved token stopped working. Paste a new one." : e.message, "bad");
      if (e.status === 401) await secrets.del("ghToken");
      return false;
    }
  }
  $("ghConnect").addEventListener("click", () => connect($("ghToken").value));
  $("ghToken").addEventListener("keydown", e => { if (e.key === "Enter") connect($("ghToken").value); });
  $("ghDisconnect").addEventListener("click", async () => { await setGh(null, null); toast("Disconnected from GitHub."); });

  // ================================================================ SETTINGS: Telegram
  async function saveTg() {
    await secrets.set("tgToken", $("tgToken").value.trim() || null);
    store.set("tgChat", $("tgChat").value.trim() || null);
    store.set("tgOn", $("tgOn").checked);
    updateShip();
  }
  let tgT;
  ["tgToken", "tgChat"].forEach(id => $(id).addEventListener("input", () => { clearTimeout(tgT); tgT = setTimeout(saveTg, 300); }));
  $("tgOn").addEventListener("change", saveTg);
  $("tgFind").addEventListener("click", async () => {
    const tok = $("tgToken").value.trim();
    if (!tok) { setStatus("tgMsg", "Paste the bot token first.", "bad"); return; }
    setStatus("tgMsg", "Looking for your message…", "info");
    try {
      const ups = await AI.telegram(tok, "getUpdates", {});
      const msg = [...(ups || [])].reverse().find(u => (u.message || u.channel_post) && (u.message || u.channel_post).chat);
      if (!msg) { setStatus("tgMsg", "No messages yet. Open your bot in Telegram, send it \"hi\", then click Find again.", "bad"); return; }
      const chat = (msg.message || msg.channel_post).chat;
      $("tgChat").value = String(chat.id); await saveTg();
      setStatus("tgMsg", `Found your chat (${chat.first_name || chat.title || chat.id}). Now send a test message.`, "ok");
    } catch (e) {
      setStatus("tgMsg", e.message + (native ? "" : " In a browser, Telegram may block this. Get your ID from @userinfobot instead."), "bad");
    }
  });
  $("tgTest").addEventListener("click", async () => {
    const tok = $("tgToken").value.trim(), chat = $("tgChat").value.trim();
    if (!tok || !chat) { setStatus("tgMsg", "Fill in both the bot token and the chat ID.", "bad"); return; }
    try {
      const r = await AI.telegram(tok, "sendMessage", { chat_id: chat, text: "👋 STEJECT is connected. You'll get a message here after every push." });
      setStatus("tgMsg", r && r.unconfirmed ? "Sent, but the browser couldn't confirm it. Check Telegram." : "Test message sent. Check Telegram.", "ok");
    } catch (e) { setStatus("tgMsg", e.message, "bad"); }
  });

  // ================================================================ SETTINGS: local AI
  let pullAbort = null;
  async function checkAi() {
    S.ai.url = $("aiUrl").value.trim() || "http://localhost:11434";
    store.set("aiUrl", S.ai.url);
    setStatus("aiMsg", "Checking…", "info");
    const st = await ollama().status();
    S.ai.ok = st.ok; S.ai.reason = st.reason; S.ai.models = st.models || [];
    if (st.ok && (!S.ai.model || !S.ai.models.some(m => m.name === S.ai.model))) {
      const pref = AI.MODELS.map(x => x.id).find(id => S.ai.models.some(m => m.name === id));
      S.ai.model = pref || (S.ai.models[0] && S.ai.models[0].name) || null;
      store.set("aiModel", S.ai.model);
    }
    $("aiSetup").hidden = st.ok;
    $("aiBrowserHint").hidden = !!native;
    setStatus("aiMsg", st.ok ? `Ollama ${st.version || ""} is running · ${plural(S.ai.models.length, "model")} installed` : st.reason === "blocked" ? "Ollama is running but refused this page." : "Ollama not found.", st.ok ? "ok" : "bad");
    renderModels(); renderAiChip(); render(); renderLearn();
  }
  function renderAiChip() {
    const chip = $("chipAi");
    if (S.provider === "groq") {
      chip.classList.toggle("on", aiOn());
      chip.classList.toggle("warn", !aiOn() && !!S.groq.key);
      chip.textContent = aiOn() ? "AI: groq" : S.groq.key ? (S.groq.bad ? "AI: bad key" : "AI: no model") : "AI: off";
      return;
    }
    chip.classList.toggle("on", S.ai.ok && !!S.ai.model);
    chip.classList.toggle("warn", S.ai.ok && !S.ai.model);
    chip.textContent = S.ai.ok ? (S.ai.model ? "AI: " + S.ai.model.split(":")[0] : "AI: no model") : "AI: off";
  }
  const gb = b => (b / 1e9).toFixed(1) + " GB";
  function renderModels() {
    const box = $("aiModels");
    if (!S.ai.ok) { box.innerHTML = `<p class="note">Start Ollama to see and download models.</p>`; return; }
    const installed = S.ai.models.map(m => ({ id: m.name, desc: gb(m.size) + " · installed", have: true }));
    const rec = AI.MODELS.filter(r => !S.ai.models.some(m => m.name === r.id)).map(r => ({ id: r.id, desc: `${r.size} · ${r.note}`, have: false }));
    box.innerHTML = [...installed, ...rec].map(m => `
      <div class="model ${m.id === S.ai.model ? "sel" : ""}">
        <span class="mn">${esc(m.id)}</span><span class="md">${esc(m.desc)}</span>
        <span class="ma">${m.have ? (m.id === S.ai.model ? `<span class="tag">In use</span>` : `<button type="button" class="btn small" data-use="${esc(m.id)}">Use</button>`) : `<button type="button" class="btn small" data-pull="${esc(m.id)}" ${pullAbort ? "disabled" : ""}>Download</button>`}</span>
      </div>`).join("");
  }
  $("aiModels").addEventListener("click", async e => {
    const use = e.target.closest("[data-use]"), pull = e.target.closest("[data-pull]");
    if (use) { S.ai.model = use.dataset.use; store.set("aiModel", S.ai.model); renderModels(); renderAiChip(); render(); toast(`Using ${S.ai.model}`); }
    if (pull) {
      const id = pull.dataset.pull;
      pullAbort = new AbortController();
      $("pullBox").hidden = false; renderModels();
      try {
        await ollama().pull(id, p => {
          const pct = p.total ? Math.round((p.completed || 0) / p.total * 100) : null;
          $("pullText").textContent = `${id}: ${p.status}${pct != null ? ` · ${pct}% of ${gb(p.total)}` : ""}`;
          if (pct != null) $("pullBar").style.width = pct + "%";
        }, pullAbort.signal);
        S.ai.model = id; store.set("aiModel", id);
        toast(`${id} is ready.`);
      } catch (err) {
        toast(err.name === "AbortError" ? "Download stopped. It resumes where it left off next time." : "Download failed: " + err.message);
      } finally {
        pullAbort = null; $("pullBox").hidden = true; $("pullBar").style.width = "0";
        checkAi();
      }
    }
  });
  $("pullStop").addEventListener("click", () => pullAbort && pullAbort.abort());
  $("aiCheck").addEventListener("click", checkAi);
  $("aiUrl").addEventListener("change", checkAi);


  // ================================================================ SETTINGS: AI provider + Groq
  function setProvider(name, quiet) {
    S.provider = name === "groq" ? "groq" : "ollama";
    store.set("aiProvider", S.provider);
    $("provGroq").setAttribute("aria-pressed", S.provider === "groq");
    $("provOllama").setAttribute("aria-pressed", S.provider === "ollama");
    $("groqBox").hidden = S.provider !== "groq";
    $("ollamaBox").hidden = S.provider !== "ollama";
    renderGroq(); renderAiChip();
    if (!quiet) { render(); renderLearn(); if (S.provider === "ollama" && !S.ai.ok) checkAi(); }
  }
  $("provGroq").addEventListener("click", () => setProvider("groq"));
  $("provOllama").addEventListener("click", () => setProvider("ollama"));

  function renderGroq() {
    $("groqRemove").hidden = !S.groq.key;
    const ids = S.groq.models.length ? S.groq.models : AI.GROQ_MODELS.map(m => m.id);
    const pref = AI.GROQ_MODELS.map(m => m.id);
    const sorted = [...ids].sort((a, b) => {
      const ia = pref.indexOf(a), ib = pref.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
    });
    $("groqModels").innerHTML = sorted.map(id => {
      const note = (AI.GROQ_MODELS.find(m => m.id === id) || {}).note || "Available on your Groq account.";
      return `<div class="model ${id === S.groq.model ? "sel" : ""}">
        <span class="mn">${esc(id)}</span><span class="md">${esc(note)}</span>
        <span class="ma">${id === S.groq.model ? `<span class="tag">In use</span>` : `<button type="button" class="btn small" data-groq-use="${esc(id)}">Use</button>`}</span>
      </div>`;
    }).join("");
  }
  $("groqModels").addEventListener("click", e => {
    const b = e.target.closest("[data-groq-use]");
    if (!b) return;
    S.groq.model = b.dataset.groqUse; store.set("groqModel", S.groq.model);
    renderGroq(); renderAiChip(); render(); renderLearn(); toast(`Using ${S.groq.model}`);
  });

  // quiet = boot-time check: only a rejected key changes anything; being offline is not an error
  async function checkGroq(quiet) {
    if (!S.groq.key) return;
    if (!quiet) setStatus("groqMsg", "Checking the key…", "info");
    const st = await AI.groq(S.groq.key).status();
    if (st.ok) {
      S.groq.bad = false; S.groq.models = st.models;
      if (!S.groq.model || !st.models.includes(S.groq.model)) {
        S.groq.model = AI.GROQ_MODELS.map(m => m.id).find(id => st.models.includes(id)) || st.models[0] || null;
        store.set("groqModel", S.groq.model);
      }
      if (!quiet) setStatus("groqMsg", `Key works · ${plural(st.models.length, "model")} available`, "ok");
    } else if (st.reason === "badkey") {
      S.groq.bad = true;
      setStatus("groqMsg", st.message, "bad");
    } else if (!quiet) setStatus("groqMsg", st.message, "bad");
    renderGroq(); renderAiChip(); render(); renderLearn();
    return st;
  }
  $("groqSave").addEventListener("click", async () => {
    const key = $("groqKey").value.trim();
    if (!key) { setStatus("groqMsg", "Paste your Groq API key first.", "bad"); return; }
    if (/\s/.test(key) || key.length < 20) { setStatus("groqMsg", "That doesn't look like a Groq key. It starts with gsk_ and has no spaces.", "bad"); return; }
    S.groq.key = key; S.groq.bad = false;
    const st = await checkGroq(false);
    if (st && st.ok) { await secrets.set("groqKey", key); toast("Groq connected."); }
    else if (st && st.reason === "badkey") S.groq.key = "";
    renderGroq(); renderAiChip();
  });
  $("groqRemove").addEventListener("click", async () => {
    await secrets.del("groqKey");
    Object.assign(S.groq, { key: "", bad: false, models: [] });
    $("groqKey").value = ""; setStatus("groqMsg", "Key removed.", "");
    renderGroq(); renderAiChip(); render(); renderLearn();
  });

  // ================================================================ SHIP: idea to project
  let ideaSize = "small";
  $("sizeS").addEventListener("click", () => { ideaSize = "small"; $("sizeS").setAttribute("aria-pressed", true); $("sizeM").setAttribute("aria-pressed", false); });
  $("sizeM").addEventListener("click", () => { ideaSize = "medium"; $("sizeM").setAttribute("aria-pressed", true); $("sizeS").setAttribute("aria-pressed", false); });

  $("ideaGo").addEventListener("click", async () => {
    const idea = $("ideaText").value.trim();
    if (idea.length < 10) { setStatus("ideaMsg", "Describe the project in a sentence or two.", "bad"); return; }
    if (!aiOn()) { render(); return; }
    $("ideaGo").disabled = true; $("ideaStop").hidden = false;
    const messages = AI.prompts.idea(idea, ideaSize);
    const clean = t => t.trim().replace(/^```[a-z]*\n?/i, "").replace(/\n?```\s*$/, "");
    let text = "", attempt = 0, lastErr = "";
    try {
      for (;;) {
        let cut = false;
        setStatus("ideaMsg", attempt ? `Fixing a problem (try ${attempt + 1} of 3)…` : "Writing your project… this takes about half a minute.", "info");
        const out = await aiRun(signal => llm().chat(aiModel(), messages, {
          signal, temperature: 0.3, ctx: 16384, maxTokens: ideaSize === "medium" ? 7000 : 4500,
          onText: t => setStatus("ideaMsg", `${attempt ? "Fixing" : "Writing"}… ${t.length.toLocaleString()} characters so far`, "info"),
          onWait: waitNote("ideaMsg"), onFinish: r => { cut = r === "length"; },
        }));
        text = clean(out);
        if (cut) throw new Error("The project got cut off because it was too long. Try a smaller idea or the Small size.");
        try {
          const m = C.parse(text);
          if (!m.commits.length || !C.finalFiles(m).size) throw new C.ManifestError("The project has no files.");
          break;
        } catch (pe) {
          lastErr = pe.message;
          if (attempt >= 2) throw new Error("The AI kept returning a broken format (" + lastErr + "). Try again, or rephrase the idea.");
          messages.push({ role: "assistant", content: out },
            { role: "user", content: `That output has a problem: ${lastErr}\nOutput the complete manifest again, fixed. Output only the manifest.` });
          attempt++;
        }
      }
      setText(text, true);
      const st = C.stats(S.m);
      setStatus("ideaMsg", `Done: ${plural(st.files, "file")} in ${plural(st.commits, "commit")}. Read the code in the Inspect panel before you push.`, "ok");
    } catch (e) {
      setStatus("ideaMsg", e.name === "AbortError" ? "Stopped." : e.message, "bad");
    } finally { $("ideaStop").hidden = true; $("ideaGo").disabled = !aiOn(); }
  });
  $("ideaStop").addEventListener("click", () => aiAbort && aiAbort.abort());

  // ================================================================ SETTINGS: app
  function applyTheme(t) {
    store.set("theme", t);
    if (t === "system") document.documentElement.removeAttribute("data-theme"); else document.documentElement.setAttribute("data-theme", t);
    $$("[data-theme-set]").forEach(b => b.setAttribute("aria-pressed", b.dataset.themeSet === t));
    native && native.setTheme && native.setTheme(t);
  }
  $$("[data-theme-set]").forEach(b => b.addEventListener("click", () => applyTheme(b.dataset.themeSet)));
  $("resetAll").addEventListener("click", () => { $("resetBox").hidden = false; });
  $("resetNo").addEventListener("click", () => { $("resetBox").hidden = true; });
  $("resetYes").addEventListener("click", async () => {
    await secrets.del("ghToken"); await secrets.del("tgToken"); await secrets.del("groqKey");
    store.clear();
    location.reload();
  });

  // ---------- updates (desktop app): compare with the latest GitHub release
  const vnum = v => String(v).replace(/^v/, "").split(".").map(n => parseInt(n, 10) || 0);
  const newer = (a, b) => { const x = vnum(a), y = vnum(b); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; };
  async function checkUpdate(manual) {
    if (!BUILD.repo) return;
    try {
      const res = await fetch(`https://api.github.com/repos/${BUILD.repo}/releases/latest`, { headers: { Accept: "application/vnd.github+json" }, cache: "no-store" });
      if (!res.ok) throw new Error();
      const rel = await res.json();
      if (newer(rel.tag_name, BUILD.version)) {
        if (!manual && store.get("skipVersion") === rel.tag_name) return;
        $("updateText").textContent = `STEJECT ${rel.tag_name} is available (you have v${BUILD.version}).`;
        $("updateLink").href = rel.html_url;
        $("updateBar").hidden = false;
        $("updateDismiss").onclick = () => { store.set("skipVersion", rel.tag_name); $("updateBar").hidden = true; };
      } else if (manual) toast("You have the latest version.");
    } catch { if (manual) toast("Couldn't check for updates."); }
  }
  $("checkUpd").addEventListener("click", () => checkUpdate(true));

  // ================================================================ keyboard
  document.addEventListener("keydown", e => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key === "Enter" && !$("page-ship").hidden) { e.preventDefault(); if (S.mode === "kit") $("dlBtn").click(); else if (!$("pushBtn").disabled) doPush(); }
    if (mod && (e.key === "o" || e.key === "O")) { e.preventDefault(); go("ship"); $("fileIn").click(); }
    if (mod && /^[1-4]$/.test(e.key)) { e.preventDefault(); go(["ship", "learn", "history", "settings"][+e.key - 1]); }
  });
  if (native && native.onMenu) native.onMenu(cmd => {
    if (cmd === "open") { go("ship"); $("fileIn").click(); }
    else if (["ship", "learn", "history", "settings"].includes(cmd)) go(cmd);
    else if (cmd === "check-updates") checkUpdate(true);
  });

  // ================================================================ boot
  (async function boot() {
    applyTheme(store.get("theme", "system"));
    showTpl();
    $("aiUrl").value = S.ai.url;
    S.groq.key = (await secrets.get("groqKey")) || "";
    $("groqKey").value = S.groq.key;
    setProvider(S.provider, true);
    if (S.groq.key) checkGroq(true);
    $("aboutLine").textContent = `STEJECT v${BUILD.version}${native ? " · desktop app" : ""} · open source, MIT license`;
    if (BUILD.repo) { $("repoLink").href = `https://github.com/${BUILD.repo}`; $("repoLink").hidden = false; $("checkUpd").hidden = !native; }
    $("storageNote").textContent = native ? "Tokens and keys are encrypted by your operating system and stay on this computer." : "Tokens and keys are stored in this browser only. Each one is sent only to its own service (GitHub, Telegram, Groq).";

    const draft = store.get("draft", null);
    ta.value = draft && draft.trim() ? draft : SAMPLE;
    setMode(S.mode === "update" || S.mode === "kit" ? S.mode : "new");
    reparse();

    $("tgToken").value = (await secrets.get("tgToken")) || "";
    $("tgChat").value = store.get("tgChat", "") || "";
    $("tgOn").checked = store.get("tgOn", true);
    const saved = await secrets.get("ghToken");
    if (saved) connect(saved, true); else setGh(null, null);
    updateShip();

    const page = (location.hash || "#ship").slice(1);
    go(["ship", "learn", "history", "settings"].includes(page) ? page : "ship");
    if (S.provider === "ollama") checkAi(); else { renderAiChip(); renderLearn(); }
    if (native) setTimeout(() => checkUpdate(false), 4000);

    // installable web app (not inside the desktop app or a sandboxed preview)
    if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol) && !native && !inFrame) {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    }
  })();

  window.__steject = { S, reparse, go };
})();
