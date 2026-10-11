/*
 * STEJECT Python runner (Web Worker). Runs a project's tests or main script in
 * Pyodide (Python compiled to WebAssembly). It runs in a worker so a program that
 * hangs can be stopped, and it has no access to the page, its storage or tokens.
 * Pyodide is downloaded from jsDelivr the first time (about 10 MB, then cached).
 */
"use strict";
const PYODIDE = "https://cdn.jsdelivr.net/pyodide/v0.29.5/full/";
let py = null, out = [], runs = 0;

const RUNNER = `
import json, os, sys, runpy, traceback, py_compile
os.chdir(STE_DIR)
for name in list(sys.modules):            # forget modules imported by an earlier run
    f = getattr(sys.modules[name], "__file__", None) or ""
    if f.startswith("/home/pyodide/run"):
        del sys.modules[name]
sys.path[:] = [STE_DIR] + [p for p in sys.path if not p.startswith("/home/pyodide/run")]

def done(status, detail=""):
    return json.dumps({"status": status, "detail": detail})

if STE_OP == "test":
    import pytest
    code = int(pytest.main(["-q", "--tb=short", "-p", "no:cacheprovider", "--color=no", STE_DIR]))
    result = done("pass" if code == 0 else "notests" if code == 5 else "fail", "pytest exit code %d" % code)
elif STE_OP == "compile":
    bad = 0
    for root, dirs, names in os.walk(STE_DIR):
        for n in names:
            if n.endswith(".py"):
                try:
                    py_compile.compile(os.path.join(root, n), doraise=True)
                except py_compile.PyCompileError as e:
                    print(e.msg); bad += 1
    result = done("fail" if bad else "pass")
else:
    try:
        runpy.run_path(os.path.join(STE_DIR, STE_ENTRY), run_name="__main__")
        result = done("pass")
    except EOFError:
        result = done("pass", "stopped where it asks for keyboard input")
    except SystemExit as e:
        result = done("pass" if e.code in (None, 0) else "fail", "exit code %s" % e.code)
    except BaseException as e:
        tb = e.__traceback__                  # show the student's frames, not STEJECT's runner
        while tb is not None and not tb.tb_frame.f_code.co_filename.startswith(STE_DIR):
            tb = tb.tb_next
        traceback.print_exception(type(e), e, tb)
        result = done("fail")
result
`;

async function boot() {
  if (py) return py;
  postMessage({ type: "progress", text: "Loading Python in the browser (first time about 10 MB)…" });
  importScripts(PYODIDE + "pyodide.js");
  py = await self.loadPyodide({ indexURL: PYODIDE });
  py.setStdout({ batched: s => out.push(s) });
  py.setStderr({ batched: s => out.push(s) });
  py.setStdin({ stdin: () => null });       // input() gets end-of-file instead of hanging
  return py;
}

const quiet = { messageCallback: () => {}, errorCallback: () => {} };   // no "Loading …" lines in the output
const requirements = text => String(text || "").split("\n")
  .map(l => l.split("#")[0].trim()).filter(l => l && !l.startsWith("-"));

self.onmessage = async e => {
  const { id, op, files, entry } = e.data || {};
  if (op === "ping") { postMessage({ id, type: "result", status: "pong" }); return; }
  try {
    const p = await boot();
    out = [];
    const dir = "/home/pyodide/run" + (++runs);
    p.FS.mkdirTree(dir);
    for (const [path, text] of Object.entries(files || {})) {
      const full = dir + "/" + path;
      p.FS.mkdirTree(full.slice(0, full.lastIndexOf("/")));
      p.FS.writeFile(full, text);
    }
    const reqs = requirements(files && files["requirements.txt"]).filter(r => !/^pytest\b/i.test(r));
    if (reqs.length) {
      postMessage({ type: "progress", text: "Installing " + reqs.join(", ") + "…" });
      await p.loadPackage("micropip", quiet);
      try { await p.pyimport("micropip").install(reqs); }
      catch (err) {
        postMessage({ id, type: "result", status: "unsupported", detail: "It needs packages that can't run in the browser (" + reqs.join(", ") + ").", output: String(err && err.message || err).slice(-1500) });
        return;
      }
    }
    if (op === "test") { postMessage({ type: "progress", text: "Loading pytest…" }); await p.loadPackage("pytest", quiet); }
    p.globals.set("STE_DIR", dir); p.globals.set("STE_OP", op); p.globals.set("STE_ENTRY", entry || "");
    postMessage({ id, type: "started" });
    const r = JSON.parse(await p.runPythonAsync(RUNNER));
    postMessage({ id, type: "result", ...r, output: out.join("\n").slice(-20000) });
  } catch (err) {
    postMessage({ id, type: "result", status: "error", detail: "Python couldn't start.", output: (out.join("\n") + "\n" + String(err && err.message || err)).trim().slice(-4000) });
  }
};
