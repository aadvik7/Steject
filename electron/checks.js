// STEJECT desktop checks: run a project's own tests or compiler on this computer.
// Plain Node (no Electron imports) so it can be unit-tested. main.js asks the user to approve
// the exact commands before calling run(); nothing here runs without that.
//
// Safety: a fresh temp folder that is deleted afterwards, a minimal environment (no tokens from
// your shell), a timeout that kills the whole process tree, an output cap, and no network:
// fully blocked on Linux when `unshare` allows it, otherwise package managers are switched to
// offline mode and pointed at a proxy that goes nowhere.
"use strict";
const { spawn, spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const WIN = process.platform === "win32";
const OUTPUT_CAP = 200 * 1024;

// ------------------------------------------------------------------ which tools are installed
function version(cmd, args) {
  try {
    const r = spawnSync(cmd, args, { encoding: "utf8", timeout: 8000, windowsHide: true, shell: WIN && /^(npm|npx)$/.test(cmd) });
    if (r.error || r.status !== 0 && !(r.stdout || r.stderr)) return null;
    const line = String(r.stdout || r.stderr).split("\n").find(l => l.trim());
    return line ? line.trim().slice(0, 80) : null;
  } catch { return null; }
}
let detected = null;
/** {node, npm, python, pytest, go, javac, gcc, gxx, isolation} with version strings, or null when missing. */
function detect(force) {
  if (detected && !force) return detected;
  const py = version("python3", ["--version"]) ? "python3" : version("python", ["--version"]) ? "python" : null;
  detected = {
    node: version("node", ["--version"]),
    npm: version("npm", ["--version"]),
    python: py ? version(py, ["--version"]) : null,
    pythonCmd: py,
    pytest: py ? version(py, ["-m", "pytest", "--version"]) : null,
    go: version("go", ["version"]),
    javac: version("javac", ["-version"]),
    java: version("java", ["-version"]),
    gcc: version("gcc", ["--version"]),
    gxx: version("g++", ["--version"]),
    isolation: canUnshare() ? "blocked" : "limited",
  };
  return detected;
}
function canUnshare() {
  if (process.platform !== "linux") return false;
  try { return spawnSync("unshare", ["-rn", "true"], { timeout: 5000 }).status === 0; } catch { return false; }
}

// ------------------------------------------------------------------ which commands to run
const ext = (files, re) => [...files.keys()].filter(p => re.test(p));
/**
 * The commands for this project, or {unsupported: reason}.
 * files: Map(path -> text). tools: detect(). opts.allowInstall: run npm install first (uses the network).
 * Each command: {cmd, args, label, timeout, network?}
 */
function plan(files, tools, opts) {
  opts = opts || {};
  const has = p => files.has(p);
  const missing = what => ({ unsupported: `${what} isn't installed on this computer.` });
  if (has("package.json")) {
    if (!tools.node) return missing("Node.js");
    let pkg = {};
    try { pkg = JSON.parse(files.get("package.json")) || {}; } catch { return { unsupported: "package.json isn't valid JSON." }; }
    const test = pkg.scripts && pkg.scripts.test && !/no test specified/.test(pkg.scripts.test);
    const deps = Object.keys({ ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) }).length > 0;
    const cmds = [];
    if (deps && opts.allowInstall) {
      if (!tools.npm) return missing("npm");
      cmds.push({ cmd: "npm", args: ["install", "--ignore-scripts", "--no-audit", "--no-fund"], label: "Install dependencies (uses the network)", timeout: 180000, network: true });
    }
    if (test) {
      if (!tools.npm) return missing("npm");
      cmds.push({ cmd: "npm", args: ["test"], label: "Run the tests", timeout: 90000 });
    } else {
      const js = ext(files, /\.(c|m)?js$/).filter(p => !/^(node_modules|dist|build)\//.test(p)).slice(0, 60);
      if (!js.length) return { unsupported: "No test script and no JavaScript files to check." };
      js.forEach(f => cmds.push({ cmd: "node", args: ["--check", f], label: `Check ${f} for syntax errors`, timeout: 15000 }));
    }
    return { lang: "node", cmds, note: deps && !opts.allowInstall && test ? "Dependencies are not installed (that needs the network). Turn it on in Settings if the tests need them." : "" };
  }
  if (ext(files, /\.py$/).length) {
    if (!tools.python) return missing("Python");
    const py = tools.pythonCmd;
    const tests = ext(files, /(^|\/)(test_[^/]*|[^/]*_test)\.py$|(^|\/)tests?\/.*\.py$/).length > 0;
    const cmds = [{ cmd: py, args: ["-m", "py_compile", ...ext(files, /\.py$/).slice(0, 80)], label: "Check every Python file compiles", timeout: 30000 }];
    if (tests) cmds.push(tools.pytest
      ? { cmd: py, args: ["-m", "pytest", "-q", "-p", "no:cacheprovider"], label: "Run the tests (pytest)", timeout: 90000 }
      : { cmd: py, args: ["-m", "unittest", "discover", "-q"], label: "Run the tests (unittest; pytest isn't installed)", timeout: 90000 });
    return { lang: "python", cmds };
  }
  if (has("go.mod")) {
    if (!tools.go) return missing("Go");
    return { lang: "go", cmds: [
      { cmd: "go", args: ["build", "./..."], label: "Build", timeout: 120000 },
      { cmd: "go", args: ["test", "./..."], label: "Run the tests", timeout: 120000 },
    ] };
  }
  const java = ext(files, /\.java$/);
  if (java.length) {
    if (!tools.javac) return missing("A Java compiler (javac)");
    return { lang: "java", cmds: [{ cmd: "javac", args: ["-d", ".steject-out", ...java.slice(0, 200)], label: "Compile every Java file", timeout: 90000 }] };
  }
  const cpp = ext(files, /\.(cpp|cc|cxx)$/), c = ext(files, /\.c$/);
  if (cpp.length || c.length) {
    const compiler = cpp.length ? "g++" : "gcc";
    if (!(cpp.length ? tools.gxx : tools.gcc)) return missing(compiler);
    const exe = WIN ? "program.exe" : "./program";
    return { lang: cpp.length ? "cpp" : "c", cmds: [
      { cmd: compiler, args: cpp.length ? ["-Wall", "-std=c++17", "-o", "program", ...cpp] : ["-Wall", "-std=c11", "-o", "program", ...c, "-lm"], label: "Compile", timeout: 90000 },
      { cmd: exe, args: [], label: "Run the program (stopped after 10 seconds; no keyboard input)", timeout: 10000, stillRunningOk: true, local: true },
    ] };
  }
  return { unsupported: "STEJECT doesn't know how to check this kind of project on your computer yet." };
}

/** The exact command lines, for the approval dialog. */
const show = cmd => [cmd.cmd, ...cmd.args].map(a => /[\s"]/.test(a) ? JSON.stringify(a) : a).join(" ");

// ------------------------------------------------------------------ running
function safeRel(p) {
  if (typeof p !== "string" || !p || p.includes("\0") || p.includes("\\") || p.startsWith("/") || /^[A-Za-z]:/.test(p)) return false;
  const parts = p.split("/");
  return !parts.some(s => s === ".." || s === ".git" || s === "");
}

function minimalEnv(offline) {
  const keep = ["PATH", "Path", "PATHEXT", "SystemRoot", "SYSTEMROOT", "ComSpec", "WINDIR", "TEMP", "TMP", "TMPDIR", "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "LANG", "GOROOT", "JAVA_HOME"];
  const env = {};
  keep.forEach(k => { if (process.env[k]) env[k] = process.env[k]; });
  env.CI = "true";
  env.NO_COLOR = "1";
  env.GOCACHE = env.GOCACHE || path.join(os.tmpdir(), "steject-gocache");
  if (offline) {
    Object.assign(env, {
      HTTP_PROXY: "http://127.0.0.1:9", HTTPS_PROXY: "http://127.0.0.1:9", http_proxy: "http://127.0.0.1:9", https_proxy: "http://127.0.0.1:9", NO_PROXY: "",
      npm_config_offline: "true", GOPROXY: "off", GOFLAGS: "-mod=mod", PIP_NO_INDEX: "1",
    });
  }
  return env;
}

function killTree(child) {
  if (!child || child.exitCode !== null) return;
  try {
    if (WIN) spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
    else process.kill(-child.pid, "SIGKILL");
  } catch { try { child.kill("SIGKILL"); } catch {} }
}

function runOne(c, cwd, tools, budget) {
  return new Promise(resolve => {
    const isolate = !c.network && tools.isolation === "blocked";
    const prog = c.local ? path.join(cwd, path.basename(c.cmd)) : c.cmd;   // the program we just compiled, by its full path
    const cmd = isolate ? "unshare" : prog, args = isolate ? ["-rn", prog, ...c.args] : c.args;
    let out = "", timedOut = false, child;
    const add = d => { if (budget.left > 0) { const s = String(d).slice(0, budget.left); out += s; budget.left -= s.length; } };
    try {
      child = spawn(cmd, args, {
        cwd, env: minimalEnv(!c.network), windowsHide: true, detached: !WIN, stdio: ["ignore", "pipe", "pipe"],
        shell: WIN && /^(npm|npx)$/.test(c.cmd),   // npm is a .cmd file on Windows; the arguments are fixed, never user text
      });
    } catch (e) { resolve({ code: -1, output: String(e.message), timedOut: false }); return; }
    child.stdout.on("data", add); child.stderr.on("data", add);
    const timer = setTimeout(() => { timedOut = true; killTree(child); }, c.timeout || 60000);
    child.on("error", e => { add(`\n${e.code === "ENOENT" ? `${c.cmd} wasn't found.` : e.message}\n`); });
    child.on("close", code => { clearTimeout(timer); resolve({ code: code == null ? -1 : code, output: out, timedOut }); });
  });
}

/**
 * Run the planned commands in a fresh temp folder that is always deleted afterwards.
 * Returns {status: "pass"|"fail", steps:[{label, command, code, timedOut}], output, isolation}.
 */
async function run(files, cmds, tools) {
  for (const p of files.keys()) if (!safeRel(p)) throw new Error(`Unsafe file path: ${p}`);
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "steject-check-"));
  const budget = { left: OUTPUT_CAP };
  const steps = [];
  let output = "", status = "pass";
  try {
    for (const [p, text] of files) {
      const full = path.join(dir, ...p.split("/"));
      await fs.promises.mkdir(path.dirname(full), { recursive: true });
      await fs.promises.writeFile(full, text);
    }
    for (const c of cmds) {
      const r = await runOne(c, dir, tools, budget);
      const okRun = r.code === 0 || (c.stillRunningOk && r.timedOut);
      steps.push({ label: c.label, command: show(c), code: r.code, timedOut: r.timedOut });
      output += `$ ${show(c)}\n${r.output}${r.timedOut ? `\n(stopped after ${Math.round((c.timeout || 60000) / 1000)} seconds${c.stillRunningOk ? "; it was still running, which is fine" : ""})` : ""}\n`;
      if (!okRun) { status = "fail"; break; }
    }
    if (budget.left <= 0) output += "\n(output cut off at 200 KB)\n";
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
  return { status, steps, output: output.slice(-OUTPUT_CAP), isolation: tools.isolation, dir };
}

module.exports = { detect, plan, run, show, safeRel, minimalEnv };
