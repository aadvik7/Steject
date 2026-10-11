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
let failNextCommitPost = 0, passBeforeFail = 0, lastPatch = null;
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
  if (p === "/user/repos" && m === "POST") { const r = mkRepo("aadvik/" + body.name, { "README.md": "# " + body.name + "\n" }, body.auto_init ? 1 : 0); return send(201, rj(r)); }
  const mm = p.match(/^\/repos\/([^/]+)\/([^/]+)(.*)$/);
  if (!mm) return send(404, { message: "Not Found" });
  const r = repos[mm[1] + "/" + mm[2]], rest = mm[3];
  if (!r) return send(404, { message: "Not Found" });
  if (rest === "") return send(200, rj(r));
  if (rest === "/git/ref/heads/main") return r.ref ? send(200, { object: { sha: r.ref } }) : send(409, { message: "Git Repository is empty." });
  if (rest.startsWith("/git/commits/") && m === "GET") { const c = r.commits[rest.split("/").pop()]; return c ? send(200, { sha: rest.split("/").pop(), tree: { sha: c.tree }, message: c.message }) : send(404, {}); }
  if (rest.startsWith("/git/trees/") && m === "GET") { const t = r.trees[rest.split("/").pop()]; return send(200, { tree: Object.keys(t).map(k => ({ path: k, type: "blob" })) }); }
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

(async () => {
  await new Promise(r => server.listen(0, r));
  const base = `http://localhost:${server.address().port}/`;
  const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 1000 } });
  await ctx.route("https://api.github.com/**", gh);
  await ctx.route("http://localhost:11434/**", ollama);
  await ctx.route("https://api.groq.com/**", groqMock);
  await ctx.route("https://api.telegram.org/**", route => {
    const r = route.request(); const cors = { "access-control-allow-origin": "*", "content-type": "application/json" };
    if (r.url().endsWith("/getUpdates")) return route.fulfill({ status: 200, headers: cors, body: JSON.stringify({ ok: true, result: [{ message: { chat: { id: 4242, first_name: "Aadvik" } } }] }) });
    tg.push(new URLSearchParams(r.postData()).get("text"));
    return route.fulfill({ status: 200, headers: cors, body: JSON.stringify({ ok: true, result: {} }) });
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", m => { if (m.type() === "error" && !/Failed to load resource|favicon/.test(m.text())) errors.push(m.text()); });
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

  // ---- 9d. idea to project (first reply broken, second reply good: repair loop)
  await page.click('nav [data-go="ship"]');
  await page.click("#ideaBox summary");
  ok(!(await page.isDisabled("#ideaGo")), "idea box enabled once an AI helper is ready");
  const good = "=== PROJECT: todo-cli ===\n=== FILE: todo.py ===\nimport json\n\ndef add(items, text):\n    items.append(text)\n    return items\n=== COMMIT: Add todo core ===\n=== FILE: test_todo.py ===\nfrom todo import add\n\ndef test_add():\n    assert add([], 'a') == ['a']\n=== COMMIT: Add tests ===\n=== FILE: README.md ===\n# todo-cli\n=== COMMIT: Add README ===";
  groqCalls = []; groqPlan = [{ text: "Sure! Here is your project:\n\ntodo.py\nimport json" }, { text: good }];
  await page.fill("#ideaText", "A Python command-line to-do app with tests");
  await page.click("#ideaGo");
  await page.waitForFunction(() => /Done:/.test(document.querySelector("#ideaMsg").textContent), null, { timeout: 15000 });
  ok(groqCalls.length === 2, "idea: broken first reply was sent back for repair (2 calls)");
  ok(JSON.stringify(groqCalls[1].messages.map(m => m.role)) === '["system","user","assistant","user"]' && /problem/.test(groqCalls[1].messages[3].content), "idea: repair request includes the parse error");
  ok(groqCalls[0].model === "llama-3.3-70b-versatile" && groqCalls[0].stream === true && groqCalls[0].max_tokens === 4500, "idea: request uses the chosen model, streaming and a token cap");
  ok((await page.textContent("#projName")).includes("todo-cli") && (await page.textContent("#checks")).includes("Valid"), "idea: project appears as a valid manifest");
  ok(await page.isVisible("#undoBtn"), "idea: undo offered");
  await shot({ path: `${OUT}/10-idea.png`, fullPage: true });

  // ---- 9e. Groq limits: short wait then success; daily limit message; cut-off reply
  groqCalls = [];
  groqPlan = [{ status: 429, message: "Rate limit reached for model `llama-3.3-70b-versatile` in organization `org_x` service tier `on_demand` on tokens per minute (TPM): Limit 12000, Used 11000, Requested 3000. Please try again in 1.2s. Need more tokens?" }, { text: good }];
  await page.fill("#ideaText", "Another small to-do app");
  await page.click("#ideaGo");
  await page.waitForFunction(() => /Done:/.test(document.querySelector("#ideaMsg").textContent), null, { timeout: 15000 });
  ok(groqCalls.length === 2, "rate limit (per minute): waited the time Groq asked for, then succeeded");
  groqPlan = [{ status: 429, message: "Rate limit reached for model `x` on tokens per day (TPD): Limit 100000, Used 99000, Requested 3000. Please try again in 7m12s." }];
  await page.click("#ideaGo"); await page.waitForTimeout(500);
  ok((await page.textContent("#ideaMsg")).includes("today's free Groq limit"), "rate limit (per day): plain-words message, no waiting");
  groqPlan = [{ text: good.slice(0, 120), finish: "length" }];
  await page.click("#ideaGo"); await page.waitForTimeout(600);
  ok((await page.textContent("#ideaMsg")).includes("cut off"), "cut-off reply: explained instead of a half project");

  // ---- 9f. Learn through Groq
  await page.fill("#manifest", good);
  await page.waitForTimeout(300);
  groqCalls = []; groqPlan = [{ text: "## What it does\nAdds items.\n\n```py\nitems.append(text)\n```" }];
  await page.click('nav [data-go="learn"]');
  await page.click("#lExplain");
  await page.waitForSelector("#learnOut .prose h2", { timeout: 8000 });
  ok(groqCalls.length === 1 && (await page.textContent("#learnOut")).includes("What it does"), "Learn works through Groq");
  await page.click("#chipAi"); await page.click("#groqRemove");
  ok((await page.textContent("#chipAi")) === "AI: off" && !(await page.evaluate(() => localStorage.getItem("steject.secret.groqKey"))), "removing the Groq key turns AI off and deletes it");
  await page.click("#provOllama"); await page.waitForTimeout(400);

  // ---- 10. secret blocks push
  await page.click('nav [data-go="ship"]');
  await page.fill("#manifest", '=== FILE: c.py ===\nkey = "AKIA' + "A".repeat(16) + '"\n'); await page.waitForTimeout(300);
  ok(await page.isDisabled("#pushBtn") && (await page.textContent("#shipMsg")).includes("Blocked"), "secret found: push blocked");

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
