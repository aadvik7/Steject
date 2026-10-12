/*
 * STEJECT Repo doctor: a health check for a GitHub repo. Pure functions, no network:
 * the app reads the repo and (optionally) the latest package versions, then calls diagnose().
 * Works in the browser (window.SteDoctor) and in Node (require) for tests.
 */
(function (root, factory) {
  const api = factory(root.SteCore || (typeof require === "function" ? require("./core.js") : null), root.SteSafety || (typeof require === "function" ? require("./safety.js") : null));
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.SteDoctor = api;
})(typeof self !== "undefined" ? self : this, function (C, Safety) {
  "use strict";

  // things that should never be committed, and the .gitignore line that keeps them out
  const JUNK = [
    [/(^|\/)node_modules\//, "node_modules/"], [/(^|\/)__pycache__\//, "__pycache__/"], [/\.py[co]$/, "*.pyc"],
    [/(^|\/)\.env$/, ".env"], [/(^|\/)\.DS_Store$/, ".DS_Store"], [/(^|\/)(\.venv|venv)\//, ".venv/"],
    [/(^|\/)\.pytest_cache\//, ".pytest_cache/"], [/(^|\/)\.idea\//, ".idea/"], [/(^|\/)Thumbs\.db$/, "Thumbs.db"],
    [/\.log$/, "*.log"], [/(^|\/)(dist|build)\/.+\.(js|map|css|whl|exe)$/, "dist/"],
  ];
  const SECTIONS = [
    ["install", /^#+\s*(install|setup|getting started|requirements|prerequisites)/im, "how to install"],
    ["run", /^#+\s*(usage|run|how to use|quick ?start|getting started|examples?)/im, "how to run or use it"],
    ["tests", /^#+\s*(tests?|testing|running tests)/im, "how to run the tests"],
    ["about", /^#\s+\S.*\n+\s*[A-Za-z]/m, "a one-line description under the title"],
  ];

  /** Parse "^1.2.3", "~=2.1", "==3.0" → major number, or null. */
  function major(spec) { const m = String(spec || "").match(/(\d+)(?:\.\d+)*/); return m ? +m[1] : null; }

  /** Dependencies worth looking up: [{eco: "npm"|"pypi", name, spec}] (at most `max`). */
  function depsToCheck(files, max) {
    const out = [];
    if (files.has("package.json")) {
      const pj = Safety.npmDeps(files.get("package.json"));
      if (pj) pj.deps.filter(d => !d.name.startsWith("@types/") && /\d/.test(d.spec) && !/^(git|https?|file|github):/.test(d.spec)).forEach(d => out.push({ eco: "npm", name: d.name, spec: d.spec }));
    }
    if (files.has("requirements.txt")) {
      Safety.pyDeps(files.get("requirements.txt")).filter(d => !d.url && /\d/.test(d.spec)).forEach(d => out.push({ eco: "pypi", name: d.name, spec: d.spec }));
    }
    return out.slice(0, max || 15);
  }

  /**
   * repo = {files: Map(path -> text) of the text files read, tree: [{path, size}] of every file,
   *         latest: {"npm:name": "4.2.0", "pypi:name": "2.0"} (optional)}
   * Returns {score, grade, items: [{id, ok, title, detail, weight, fix}], junk: [paths], junkIgnore: [lines]}
   */
  function diagnose(repo) {
    const files = repo.files, tree = repo.tree || [...files.keys()].map(p => ({ path: p, size: (files.get(p) || "").length }));
    const paths = tree.map(t => t.path);
    const has = re => paths.some(p => re.test(p));
    const items = [];
    const add = (id, weight, ok, title, detail, fix) => items.push({ id, weight, ok: !!ok, title, detail, fix: ok ? null : fix || null });

    // README
    const readmePath = paths.find(p => /^readme(\.(md|rst|txt))?$/i.test(p));
    const readme = readmePath ? files.get(readmePath) || "" : "";
    add("readme", 15, !!readmePath, "README", readmePath ? `Found ${readmePath}.` : "No README. It's the first thing people (and recruiters) read.", "readme");
    if (readmePath) {
      const missing = SECTIONS.filter(([, re]) => !re.test(readme)).map(s => s[2]);
      add("readme-sections", 10, !missing.length && readme.length > 200, "README explains the basics",
        missing.length ? `Missing: ${missing.join(", ")}.` : readme.length > 200 ? "Has install, run and test sections." : "The README is very short.", "readme");
    }
    // LICENSE
    const lic = paths.find(p => /^(licen[cs]e|copying)(\.(md|txt))?$/i.test(p));
    add("license", 10, !!lic, "LICENSE", lic ? `Found ${lic}.` : "No license, so legally nobody may reuse the code. MIT is a common, simple choice.", "license");
    // .gitignore and committed junk
    const gi = paths.includes(".gitignore");
    add("gitignore", 5, gi, ".gitignore", gi ? "Found .gitignore." : "No .gitignore, so build output and secrets files can get committed by accident.", "gitignore");
    const junk = paths.filter(p => JUNK.some(([re]) => re.test(p)));
    const junkIgnore = [...new Set(junk.map(p => JUNK.find(([re]) => re.test(p))[1]))];
    add("junk", 10, !junk.length, "No committed junk", junk.length ? `${junk.length} file(s) that shouldn't be in Git, e.g. ${junk.slice(0, 3).join(", ")}${junk.some(p => /(^|\/)\.env$/.test(p)) ? ". A committed .env usually means leaked passwords: change them." : "."}` : "No build folders, caches or .env files.", "junk");
    // tests
    const tests = paths.filter(p => C.classify(p) === "tests");
    add("tests", 15, tests.length > 0, "Tests", tests.length ? `${tests.length} test file(s).` : "No tests found. Tests prove the code works and are a big plus in interviews.", "tests");
    // CI
    const ci = has(/^\.github\/workflows\/.+\.ya?ml$/);
    add("ci", 10, ci, "Continuous integration", ci ? "GitHub Actions workflows found." : "No CI, so nothing runs the tests automatically on each push.", "ci");
    // big files
    const big = tree.filter(t => t.size > 1024 * 1024).sort((a, b) => b.size - a.size);
    const huge = big.filter(t => t.size > 50 * 1024 * 1024);
    add("big", 5, !big.length, "No big files", big.length ? `${big.length} file(s) over 1 MB${huge.length ? `, ${huge.length} over 50 MB (GitHub warns at 50 MB and refuses 100 MB)` : ""}: ${big.slice(0, 3).map(t => `${t.path} (${(t.size / 1048576).toFixed(1)} MB)`).join(", ")}.` : "Nothing over 1 MB.", null);
    // secrets
    const m = { project: "repo", commits: [{ message: "x", files }] };
    const secrets = C.scanSecrets(m);
    add("secrets", 15, !secrets.length, "No leaked secrets", secrets.length ? `${secrets.length} possible secret(s), e.g. ${secrets[0].name} in ${secrets[0].path} line ${secrets[0].line}. Revoke them now: removing them from the code doesn't remove them from Git history.` : "No API keys, tokens or passwords found.", null);
    // dependencies
    const deps = depsToCheck(files, 15), latest = repo.latest || {};
    const looked = deps.filter(d => latest[d.eco + ":" + d.name]);
    const stale = looked.filter(d => { const a = major(d.spec), b = major(latest[d.eco + ":" + d.name]); return a != null && b != null && b > a; });
    if (deps.length) add("deps", 5, !stale.length, "Dependencies are current", !looked.length ? "Couldn't look up the latest versions." : stale.length ? `${stale.length} of ${looked.length} are a major version behind: ${stale.slice(0, 4).map(d => `${d.name} ${d.spec} → ${latest[d.eco + ":" + d.name]}`).join(", ")}.` : `All ${looked.length} checked are on the latest major version.`, null);
    // structure
    const rootFiles = paths.filter(p => !p.includes("/"));
    const code = paths.filter(p => C.classify(p) === "code" && /\.(py|js|ts|jsx|tsx|java|go|c|cpp|rb|php|cs|rs|kt|swift)$/.test(p));
    const rootCode = code.filter(p => !p.includes("/"));
    const messy = rootFiles.length > 20 || (code.length > 12 && rootCode.length / code.length > 0.7);
    add("structure", 5, !messy, "Clear structure", messy ? `${rootFiles.length} files sit in the top folder${code.length > 12 ? ` and ${rootCode.length} of ${code.length} code files are there` : ""}. Group code into folders (src/, tests/) so it's easy to find your way around.` : "Files are organised into folders.", null);

    const total = items.reduce((n, i) => n + i.weight, 0);
    const got = items.reduce((n, i) => n + (i.ok ? i.weight : 0), 0);
    const score = Math.round(got / total * 100);
    const grade = score >= 90 ? "Excellent" : score >= 75 ? "Good" : score >= 50 ? "Needs work" : "Needs a lot of work";
    return { score, grade, items, junk, junkIgnore, stale };
  }

  return { diagnose, depsToCheck, major, JUNK };
});
