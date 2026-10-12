/*
 * STEJECT runner: checks that a project actually runs before it is shipped.
 *  - Python: tests (pytest) or the main script, in Pyodide inside a Web Worker (js/pyworker.js).
 *  - Web pages: opened in a sandboxed frame (preview.html) with no network; errors are collected.
 * AI-written code never runs with access to the app, its storage or tokens.
 */
(function (root) {
  "use strict";
  const C = root.SteCore;

  // ------------------------------------------------------------------ Python worker
  let worker = null, seq = 0;
  const waiting = new Map();
  let progressCb = null;

  function getWorker() {
    if (worker) return worker;
    worker = new Worker("js/pyworker.js");
    worker.onmessage = e => {
      const d = e.data || {};
      if (d.type === "progress") { progressCb && progressCb(d.text); return; }
      const w = waiting.get(d.id);
      if (!w) return;
      if (d.type === "started") { w.started(); return; }
      if (d.type === "result") { waiting.delete(d.id); w.resolve(d); }
    };
    worker.onerror = e => {
      const msg = (e && e.message) || "The Python runner crashed.";
      kill();
      waiting.forEach(w => w.resolve({ status: "error", detail: "The Python runner couldn't start.", output: msg }));
      waiting.clear();
    };
    return worker;
  }
  function kill() { if (worker) { worker.terminate(); worker = null; } }

  /** op: "test" | "run" | "compile". Resolves {status, detail, output}. */
  function python(op, files, entry, opts) {
    opts = opts || {};
    progressCb = opts.onProgress || null;
    const id = ++seq, limit = opts.timeout || (op === "test" ? 60000 : 15000);
    return new Promise(resolve => {
      let timer = null;
      const finish = r => { clearTimeout(timer); if (opts.signal) opts.signal.removeEventListener("abort", onAbort); resolve(r); };
      const onAbort = () => { waiting.delete(id); kill(); finish({ status: "stopped", detail: "Stopped.", output: "" }); };
      waiting.set(id, {
        resolve: finish,
        started: () => {
          timer = setTimeout(() => {
            waiting.delete(id); kill();
            finish(op === "run"
              ? { status: "pass", detail: `still running after ${limit / 1000}s (a server or a loop), so STEJECT stopped it`, output: "" }
              : { status: "fail", detail: `took longer than ${limit / 1000}s`, output: "" });
          }, limit);
        },
      });
      if (opts.signal) { if (opts.signal.aborted) return onAbort(); opts.signal.addEventListener("abort", onAbort); }
      getWorker().postMessage({ id, op, files: Object.fromEntries(files), entry });
    });
  }

  // ------------------------------------------------------------------ web preview
  /**
   * Open a web project in a sandboxed frame inside `host`.
   * Resolves {status, errors, logs} after the page loads and settles (check) or right away (live preview).
   */
  function web(files, html, host, opts) {
    opts = opts || {};
    host.innerHTML = "";
    const frame = document.createElement("iframe");
    frame.className = "preview";
    frame.title = "Project preview";
    frame.setAttribute("sandbox", "allow-scripts allow-forms");
    frame.setAttribute("referrerpolicy", "no-referrer");
    frame.src = "preview.html";
    const logs = [];
    return new Promise(resolve => {
      let settled = false, timer = null;
      const finish = () => {
        if (settled) return; settled = true;
        clearTimeout(timer); removeEventListener("message", onMsg);
        const errors = logs.filter(l => l.level === "error");
        resolve({ status: errors.length ? "fail" : "pass", errors, logs, output: logs.map(l => (l.level === "error" ? "ERROR " : "") + l.text).join("\n") });
      };
      const onMsg = e => {
        if (e.source !== frame.contentWindow) return;
        const d = e.data || {};
        if (d.steject !== "preview") return;
        if (d.type === "ready") frame.contentWindow.postMessage({ steject: "load", html, files: Object.fromEntries(files) }, "*");
        else if (d.type === "log" && d.level === "loaded") { clearTimeout(timer); timer = setTimeout(finish, opts.settle || 1500); }
        else if (d.type === "log") { logs.push({ level: d.level, text: d.text }); opts.onLog && opts.onLog(d); }
      };
      addEventListener("message", onMsg);
      timer = setTimeout(finish, opts.timeout || 8000);
      host.appendChild(frame);
    });
  }

  // ------------------------------------------------------------------ desktop: real tools on this computer (asks first)
  const LANG = { node: "Node.js", python: "Python", go: "Go", java: "Java", c: "C", cpp: "C++" };
  async function desktop(files, st, opts) {
    opts.onProgress && opts.onProgress("Waiting for you to approve the commands…");
    const r = await opts.native.run(Object.fromEntries(files), { project: opts.project, allowInstall: !!opts.allowInstall });
    if (r.status !== "pass" && r.status !== "fail") return { status: "unsupported", kind: st.lang, summary: r.status === "denied" ? "Not run" : "Can't run here", detail: r.detail, output: "" };
    const failed = r.status === "fail" ? r.steps[r.steps.length - 1] : null;
    return {
      status: r.status, kind: r.lang || st.lang, desktop: true, isolation: r.isolation, commands: r.commands,
      summary: r.status === "pass" ? `${LANG[r.lang] || "Checks"}: all checks pass on this computer` : `Failed: ${failed ? failed.label.toLowerCase() : "a check"}`,
      detail: r.note || "", output: r.output,
    };
  }

  // ------------------------------------------------------------------ check
  /**
   * Does this project run? Resolves {status: "pass"|"fail"|"unsupported"|"stopped"|"error", kind, summary, output}.
   * Python: tests if it has them, else compile + run the entry script. Web: open it and collect errors.
   */
  async function check(m, opts) {
    opts = opts || {};
    const files = C.finalFiles(m), st = C.detectStack(files);
    const say = t => opts.onProgress && opts.onProgress(t);
    if (st.lang === "python") {
      let r;
      if (st.tests) {
        say("Running the tests…");
        r = await python("test", files, null, { ...opts, onProgress: say });
        if (r.status === "unsupported" && opts.native) return desktop(files, st, opts);   // packages the browser can't run
        if (r.status === "pass") return { ...r, kind: "python", summary: "Tests pass" };
        if (r.status !== "notests") return { ...r, kind: "python", summary: r.status === "fail" ? "Tests fail" : r.detail || "Couldn't run" };
      }
      say("Checking the Python files…");
      r = await python("compile", files, null, { ...opts, onProgress: say });
      if (r.status === "unsupported" && opts.native) return desktop(files, st, opts);   // packages the browser can't run
      if (r.status !== "pass") return { ...r, kind: "python", summary: r.status === "fail" ? "Syntax errors" : r.detail || "Couldn't run" };
      if (!st.entry) return { ...r, kind: "python", summary: "Compiles (nothing to run)" };
      say(`Running ${st.entry}…`);
      r = await python("run", files, st.entry, { ...opts, onProgress: say });
      return { ...r, kind: "python", summary: r.status === "pass" ? `${st.entry} runs${r.detail ? " (" + r.detail + ")" : ""}` : r.status === "fail" ? `${st.entry} crashes` : r.detail || "Couldn't run" };
    }
    if (st.web && opts.host) {
      say(`Opening ${st.html}…`);
      const r = await web(files, st.html, opts.host, { timeout: 8000 });
      opts.host.innerHTML = "";   // stop the checked page; the live preview has its own frame
      return { ...r, kind: "web", summary: r.status === "pass" ? "Page loads without errors" : `${r.errors.length} error${r.errors.length === 1 ? "" : "s"} on the page` };
    }
    if (opts.native && LANG[st.lang]) return desktop(files, st, opts);
    const why = { node: "Node.js projects", java: "Java projects", go: "Go projects", c: "C projects", cpp: "C++ projects" }[st.lang] || "This kind of project";
    return { status: "unsupported", kind: st.lang, summary: "Can't run here", detail: `${why} can't run in the browser version. The desktop app can run their checks with the tools on your computer, or run ${st.test || st.run || "it"} yourself.`, output: "" };
  }

  root.SteRun = { check, python, web, stop: kill };
})(typeof self !== "undefined" ? self : this);
