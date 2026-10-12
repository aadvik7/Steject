// Smoke test of the desktop app: launches Electron, checks the bridge, encrypted
// secrets and the CORS shim against a fake Ollama that behaves like the real one
// (403 for foreign Origins, no CORS headers).
// Run (Linux CI): xvfb-run -a node test/electron.smoke.js
const path = require("path");
const http = require("http");
const { _electron: electron } = require(process.env.PW_PATH || "playwright");

let failures = 0;
const ok = (c, m) => { if (c) console.log("ok -", m); else { failures++; console.error("FAIL -", m); } };

const fakeOllama = http.createServer((req, res) => {
  if (req.headers.origin) { res.writeHead(403); return res.end(); }          // what real Ollama does for unknown origins
  if (req.url === "/api/tags") { res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify({ models: [{ name: "llama3.2:3b", size: 2e9 }] })); }
  if (req.url === "/api/version") { res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify({ version: "0.12.0" })); }
  res.writeHead(404); res.end();
});

(async () => {
  await new Promise(r => fakeOllama.listen(11434, "127.0.0.1", r));
  const app = await electron.launch({
    executablePath: require(path.join(__dirname, "..", "node_modules", "electron")),
    args: [path.join(__dirname, ".."), "--no-sandbox"],
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: "1", STEJECT_TEST_APPROVE: "1" },
  });
  const win = await app.firstWindow();
  await win.waitForLoadState("domcontentloaded");
  await win.waitForTimeout(1500);
  ok((await win.title()) === "STEJECT", "window opens with title STEJECT");
  ok(await win.evaluate(() => !!(window.steNative && window.steNative.isDesktop)), "desktop bridge is available");
  ok(await win.evaluate(() => typeof require === "undefined" && typeof process === "undefined"), "page has no Node access (sandboxed)");
  await win.evaluate(() => window.steNative.secrets.set("probe", "s3cret"));
  ok((await win.evaluate(() => window.steNative.secrets.get("probe"))) === "s3cret", "secrets round-trip");
  await win.evaluate(() => window.steNative.secrets.del("probe"));
  ok((await win.evaluate(() => window.steNative.secrets.get("probe"))) === null, "secrets delete");
  ok((await win.textContent("#checks")).includes("Valid"), "sample manifest renders");
  await win.evaluate(() => { document.getElementById("aiUrl").value = "http://127.0.0.1:11434"; document.getElementById("aiUrl").dispatchEvent(new Event("change")); });
  await win.waitForFunction(() => /llama3\.2/.test(document.getElementById("chipAi").textContent), null, { timeout: 8000 }).catch(() => {});
  ok((await win.textContent("#chipAi")).includes("llama3.2"), "desktop app reaches Ollama without OLLAMA_ORIGINS (CORS shim works)");
  const fonts = await win.evaluate(async () => { await document.fonts.ready; return ["Big Shoulders Display", "Public Sans", "JetBrains Mono"].map(f => document.fonts.check(`16px "${f}"`)); });
  ok(fonts.every(Boolean), "bundled fonts load offline");
  // the page may only call its fixed host list; user-chosen AI addresses go through js/networker.js
  const blocked = await win.evaluate(async () => { try { await fetch("https://example.com"); return false; } catch { return true; } });
  ok(blocked, "content security policy blocks hosts that aren't on the list");
  const viaWorker = await win.evaluate(async () => { try { const r = await SteNet.viaWorker("http://127.0.0.1:11434/api/version"); return (await r.json()).version; } catch (e) { return "error " + e.message; } });
  ok(viaWorker === "0.12.0", "network worker reaches a user-chosen address (" + viaWorker + ")");
  const worker = await win.evaluate(() => new Promise(res => {
    try { const w = new Worker("js/pyworker.js"); w.onmessage = e => res(e.data && e.data.status); w.onerror = e => res("error " + (e.message || "")); w.postMessage({ id: 1, op: "ping" }); setTimeout(() => res("timeout"), 5000); }
    catch (e) { res("throw " + e.message); }
  }));
  ok(worker === "pong", "Python runner worker starts in the desktop app (" + worker + ")");
  const preview = await win.evaluate(() => new Promise(res => {
    const f = document.createElement("iframe");
    f.setAttribute("sandbox", "allow-scripts allow-forms"); f.src = "preview.html"; f.style.display = "none";
    addEventListener("message", e => { if (e.source === f.contentWindow && e.data && e.data.steject === "preview" && e.data.type === "ready") res("ready"); });
    setTimeout(() => res("timeout"), 5000);
    document.body.appendChild(f);
  }));
  ok(preview === "ready", "sandboxed project preview loads in the desktop app");
  ok(await win.evaluate(() => typeof window.steNative.allowHost === "function"), "bridge can allow the user's AI address");
  const tools = await win.evaluate(() => window.steNative.checks.detect());
  ok(/^v\d+/.test(tools.node || ""), "desktop checks: finds the installed Node.js (" + tools.node + ", network " + tools.isolation + ")");
  const pass = await win.evaluate(() => window.steNative.checks.run({
    "package.json": JSON.stringify({ scripts: { test: "node --test" } }),
    "a.test.js": "require('node:test')('adds', () => require('node:assert').equal(1 + 1, 2));\n",
  }, { project: "smoke" }));
  ok(pass.status === "pass" && pass.commands[0] === "npm test", "desktop checks: runs a project's tests on this computer (" + pass.status + ")");
  const fail = await win.evaluate(() => window.steNative.checks.run({ "bad.js": "function (\n" }, { project: "smoke2" }));
  ok(fail.status === "fail" && /SyntaxError/.test(fail.output), "desktop checks: reports a failure with its output");
  await win.screenshot({ path: path.join(process.env.SHOTS || path.join(__dirname, "shots"), "electron.png") });
  await app.close();
  fakeOllama.close();
  console.log(failures ? `\n${failures} FAILED` : "\nall passed");
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
