// Tests for electron/checks.js (desktop "Run checks"). Runs real commands for tools that are installed;
// tests for a missing tool are skipped. Run: npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const Checks = require("../electron/checks.js");

const tools = Checks.detect();
const files = obj => new Map(Object.entries(obj));
const NODE_PKG = (testCmd, extra) => JSON.stringify({ name: "x", version: "1.0.0", scripts: { test: testCmd }, ...(extra || {}) });

test("detect finds Node (the test runner itself)", () => {
  assert.match(tools.node, /^v\d+/);
  assert.ok(["blocked", "limited"].includes(tools.isolation));
});

test("plan picks commands by language and never runs npm install unless allowed", () => {
  const all = { ...tools, node: "v22", npm: "10", python: "Python 3.12", pythonCmd: "python3", pytest: "pytest 8", go: "go1.23", javac: "javac 21", gcc: "gcc 13", gxx: "g++ 13" };
  const node = Checks.plan(files({ "package.json": NODE_PKG("node --test", { dependencies: { chalk: "^5" } }) }), all);
  assert.deepEqual(node.cmds.map(Checks.show), ["npm test"]);
  assert.match(node.note, /Dependencies are not installed/);
  const nodeInstall = Checks.plan(files({ "package.json": NODE_PKG("node --test", { dependencies: { chalk: "^5" } }) }), all, { allowInstall: true });
  assert.deepEqual(nodeInstall.cmds.map(c => [Checks.show(c), !!c.network]), [["npm install --ignore-scripts --no-audit --no-fund", true], ["npm test", false]]);
  const loose = Checks.plan(files({ "app.js": "", "util.js": "" }), all);
  assert.deepEqual(loose.cmds.map(Checks.show), ["node --check app.js", "node --check util.js"], "plain JavaScript without package.json");
  const noTest = Checks.plan(files({ "package.json": "{}", "a.js": "", "lib/b.mjs": "" }), all);
  assert.deepEqual(noTest.cmds.map(Checks.show), ["node --check a.js", "node --check lib/b.mjs"]);
  const py = Checks.plan(files({ "app.py": "", "test_app.py": "" }), all);
  assert.deepEqual(py.cmds.map(Checks.show), ["python3 -m py_compile app.py test_app.py", "python3 -m pytest -q -p no:cacheprovider"]);
  const go = Checks.plan(files({ "go.mod": "module x", "main.go": "" }), all);
  assert.deepEqual(go.cmds.map(Checks.show), ["go build ./...", "go test ./..."]);
  const java = Checks.plan(files({ "src/Main.java": "" }), all);
  assert.deepEqual(java.cmds.map(Checks.show), ["javac -d .steject-out src/Main.java"]);
  const c = Checks.plan(files({ "main.c": "" }), all);
  assert.equal(c.lang, "c");
  assert.match(Checks.show(c.cmds[0]), /^gcc -Wall -std=c11 -o program main\.c -lm$/);
  assert.match(Checks.plan(files({ "main.go": "" }), { ...all, go: null }).unsupported, /isn't installed|doesn't know/);
  assert.match(Checks.plan(files({ "x.go": "" , "go.mod": "" }), { ...all, go: null }).unsupported, /Go isn't installed/);
});

test("run: a passing Node project passes, and the temp folder is deleted", async () => {
  const f = files({ "package.json": NODE_PKG("node --test"), "math.test.js": "const t=require('node:test'),a=require('node:assert');t('adds',()=>a.equal(1+1,2));\n" });
  const p = Checks.plan(f, tools);
  const r = await Checks.run(f, p.cmds, tools);
  assert.equal(r.status, "pass", r.output);
  assert.match(r.output, /\$ npm test/);
  assert.equal(fs.existsSync(r.dir), false, "temp folder removed");
});

test("run: a failing test fails with its output", async () => {
  const f = files({ "package.json": NODE_PKG("node --test"), "math.test.js": "const t=require('node:test'),a=require('node:assert');t('adds',()=>a.equal(1+1,3));\n" });
  const r = await Checks.run(f, Checks.plan(f, tools).cmds, tools);
  assert.equal(r.status, "fail");
  assert.match(r.output, /3/);
});

test("run: a hung program is killed at the timeout", async () => {
  const f = files({ "loop.js": "setInterval(() => {}, 1000);\n" });
  const t0 = Date.now();
  const r = await Checks.run(f, [{ cmd: "node", args: ["loop.js"], label: "loop", timeout: 1500 }], tools);
  assert.equal(r.status, "fail");
  assert.ok(r.steps[0].timedOut && Date.now() - t0 < 10000);
  const ok = await Checks.run(f, [{ cmd: "node", args: ["loop.js"], label: "loop", timeout: 1000, stillRunningOk: true }], tools);
  assert.equal(ok.status, "pass", "programs that keep running can count as running");
});

test("run: no tokens from your environment reach the project", async () => {
  process.env.GITHUB_TOKEN = "ghp_should_not_leak";
  const f = files({ "env.js": "console.log('TOKEN=' + (process.env.GITHUB_TOKEN || 'none') + ' PROXY=' + process.env.HTTPS_PROXY)\n" });
  const r = await Checks.run(f, [{ cmd: "node", args: ["env.js"], label: "env", timeout: 15000 }], tools);
  delete process.env.GITHUB_TOKEN;
  assert.match(r.output, /TOKEN=none PROXY=http:\/\/127\.0\.0\.1:9/);
});

test("run: output is capped and unsafe paths are refused", async () => {
  const f = files({ "big.js": "process.stdout.write('x'.repeat(300000))\n" });
  const r = await Checks.run(f, [{ cmd: "node", args: ["big.js"], label: "big", timeout: 15000 }], tools);
  assert.ok(r.output.length <= 200 * 1024 && /cut off/.test(r.output));
  await assert.rejects(Checks.run(files({ "../evil.js": "" }), [], tools), /Unsafe file path/);
  assert.equal(Checks.safeRel("C:/x"), false);
  assert.equal(Checks.safeRel("a/.git/config"), false);
});

test("run: Python compiles (when Python is installed)", { skip: !tools.python }, async () => {
  const f = files({ "ok.py": "print('hi')\n", "bad.py": "def f(:\n" });
  const r = await Checks.run(f, Checks.plan(f, tools).cmds, tools);
  assert.equal(r.status, "fail");
  assert.match(r.output, /bad\.py/);
});
