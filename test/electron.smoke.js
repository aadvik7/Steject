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
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: "1" },
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
  const blocked = await win.evaluate(async () => { try { await fetch("https://example.com"); return false; } catch { return true; } });
  ok(blocked, "content security policy blocks unknown hosts");
  await win.screenshot({ path: path.join(process.env.SHOTS || path.join(__dirname, "shots"), "electron.png") });
  await app.close();
  fakeOllama.close();
  console.log(failures ? `\n${failures} FAILED` : "\nall passed");
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
