/*
 * STEJECT core: manifest parsing, chat-reply conversion, secret scan, diff,
 * offline ship script. Pure functions, no DOM. Works in the browser
 * (window.SteCore) and in Node (require) for tests.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.SteCore = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const MARKER = /^=== (PROJECT|FILE|COMMIT|DELETE): (.+?) ===\s*$/;
  const PROJECT_NAME = /^[A-Za-z0-9._-]{1,100}$/;

  const SECRETS = [
    ["GitHub token", /gh[pousr]_[A-Za-z0-9]{36,}/],
    ["GitHub fine-grained token", /github_pat_[A-Za-z0-9_]{50,}/],
    ["AWS access key", /AKIA[0-9A-Z]{16}/],
    ["API key (sk-…)", /sk-[A-Za-z0-9_\-]{20,}/],
    ["Groq API key", /gsk_[A-Za-z0-9]{40,}/],
    ["Hugging Face token", /hf_[A-Za-z0-9]{30,}/],
    ["npm token", /npm_[A-Za-z0-9]{36}/],
    ["Google API key", /AIza[0-9A-Za-z_\-]{35}/],
    ["Slack token", /xox[baprs]-[A-Za-z0-9-]{10,}/],
    ["Stripe live key", /(sk|rk)_live_[A-Za-z0-9]{20,}/],
    ["Telegram bot token", /\b\d{8,10}:[A-Za-z0-9_-]{35}\b/],
    ["Private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
    ["Hardcoded secret", /(api[_-]?key|secret|passwd|password|token)\s*[=:]\s*['"][^'"\s]{12,}['"]/i],
  ];

  class ManifestError extends Error {}

  function safePath(p) {
    if (p.includes("\\") || p.startsWith("/") || /^[A-Za-z]:/.test(p)) throw new ManifestError(`Unsafe file path: ${p}`);
    const parts = p.split("/").filter(s => s !== "" && s !== ".");
    if (!parts.length || parts.includes("..") || parts.includes(".git")) throw new ManifestError(`Unsafe file path: ${p}`);
    return parts.join("/");
  }

  /**
   * Parse a manifest.
   * Returns {project, commits:[{message, files: Map(path -> content|null)}]}
   * content === null means "delete this file".
   */
  function parse(text) {
    let lines = String(text).replace(/\r\n?/g, "\n").split("\n");
    while (lines.length && !lines[0].trim()) lines.shift();
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    if (lines.length >= 2 && /^```/.test(lines[0]) && lines[lines.length - 1].trim() === "```") lines = lines.slice(1, -1);

    let project = "my-project", sawProject = false;
    const commits = [];
    let pending = new Map(), cur = null, buf = [];
    const flush = () => {
      if (cur !== null) {
        const body = buf.join("\n").replace(/^\n+|\n+$/g, "");
        pending.set(cur, body ? body + "\n" : "");
      }
      cur = null; buf = [];
    };
    lines.forEach((line, i) => {
      const n = i + 1, m = line.match(MARKER);
      if (!m) {
        if (cur !== null) buf.push(line);
        else if (line.trim()) throw new ManifestError(`Line ${n}: text found outside a FILE block: "${line.slice(0, 60)}"`);
        return;
      }
      const kind = m[1], value = m[2].trim();
      flush();
      if (kind === "PROJECT") {
        if (!PROJECT_NAME.test(value)) throw new ManifestError(`Bad project name: "${value}". Use letters, numbers, - _ . only.`);
        project = value; sawProject = true;
      } else if (kind === "FILE") {
        cur = safePath(value);
      } else if (kind === "DELETE") {
        pending.set(safePath(value), null);
      } else {
        if (!pending.size) throw new ManifestError(`Line ${n}: COMMIT "${value}" has no files before it`);
        commits.push({ message: value, files: pending });
        pending = new Map();
      }
    });
    flush();
    if (pending.size) commits.push({ message: "Add project files", files: pending });
    if (!commits.length) throw new ManifestError("No FILE blocks found. This doesn't look like a STEJECT manifest.");
    return { project, commits, sawProject };
  }

  /** Serialize a parsed manifest back to text. */
  function serialize(m) {
    const out = [`=== PROJECT: ${m.project} ===`];
    m.commits.forEach(c => {
      c.files.forEach((content, path) => {
        if (content === null) { out.push(`=== DELETE: ${path} ===`); return; }
        out.push(`=== FILE: ${path} ===`);
        if (content) out.push(content.replace(/\n$/, ""));
      });
      out.push(`=== COMMIT: ${c.message} ===`);
    });
    return out.join("\n") + "\n";
  }

  /** Last version of every file across commits (deletes remove). */
  function finalFiles(m) {
    const out = new Map();
    m.commits.forEach(c => c.files.forEach((v, k) => { if (v === null) out.delete(k); else out.set(k, v); }));
    return out;
  }

  function stats(m) {
    let files = 0, lines = 0, deletes = 0;
    m.commits.forEach(c => c.files.forEach(v => {
      if (v === null) { deletes++; return; }
      files++; lines += v ? v.split("\n").length - 1 : 0;
    }));
    return { files, lines, deletes, commits: m.commits.length };
  }

  // "password = 'your-password-here'" is an example, not a leak (only for the generic rule; real token formats always count)
  const PLACEHOLDER = /^(your|my|example|sample|change[-_]?me|replace|placeholder|dummy|fake|test|xxx|\*{3}|<|\$\{|\{\{|todo|insert|put[-_])/i;
  function isPlaceholderSecret(name, line) {
    if (name !== "Hardcoded secret") return false;
    const m = String(line).match(/[=:]\s*['"]([^'"\s]{12,})['"]/);
    return !!m && (PLACEHOLDER.test(m[1]) || /here|example|your[-_]/i.test(m[1]));
  }
  function scanSecrets(m) {
    const hits = [];
    m.commits.forEach(c => c.files.forEach((content, path) => {
      if (!content) return;
      content.split("\n").forEach((line, i) => {
        for (const [name, re] of SECRETS) if (re.test(line) && !isPlaceholderSecret(name, line)) { hits.push({ path, line: i + 1, name }); break; }
      });
    }));
    return hits;
  }

  // ------------------------------------------------------------------ converter
  // Turn a normal chat reply (headings / bold file names + code blocks) into a manifest.

  const FILE_RE = /((?:[A-Za-z0-9_.\-]+\/)*(?:[A-Za-z0-9_\-][A-Za-z0-9_.\-]*\.[A-Za-z0-9]{1,10}|Dockerfile|Makefile|Procfile|LICENSE|\.gitignore|\.env\.example|\.dockerignore|\.editorconfig))/;
  const NOT_FILES = /^(e\.g\.|i\.e\.|etc\.|v\d|\d+\.\d+)/i;

  function fileFromLabel(line) {
    let s = line.trim();
    if (!s) return null;
    // common label shapes
    s = s.replace(/^#{1,6}\s*/, "")            // ### app.py
         .replace(/^[-*]\s+/, "")               // - app.py
         .replace(/^\d+[.)]\s+/, "")            // 1. app.py
         .replace(/^(file(name)?|path|create|update|in)\s*[:\-–]?\s*/i, "")
         .replace(/[*`"']/g, " ")
         .replace(/\s*[:：]\s*$/, "")
         .trim();
    const tokens = s.split(/\s+/);
    // a label is short: the file name is one of the first few tokens
    if (tokens.length > 8) return null;
    for (const tok of tokens) {
      const t = tok.replace(/^[(\[_]+|[)\],.;_]+$/g, "");
      const m = t.match(new RegExp("^" + FILE_RE.source + "$"));
      if (m && !NOT_FILES.test(t)) return t.replace(/^\.\//, "");
    }
    return null;
  }

  function fileFromFirstLine(line) {
    const m = line.match(/^\s*(?:#|\/\/|--|;|<!--|\/\*)\s*(?:file(?:name)?\s*[:=]\s*)?(\S+?)\s*(?:-->|\*\/)?\s*$/i);
    if (!m) return null;
    const t = m[1].replace(/^\.\//, "");
    return new RegExp("^" + FILE_RE.source + "$").test(t) && t.includes(".") || /^(Dockerfile|Makefile)$/.test(t) ? t : null;
  }

  function classify(path) {
    const base = path.split("/").pop().toLowerCase();
    if (/^(readme|changelog|contributing|license)(\.|$)/.test(base) || /^docs\//.test(path) || /\.(md|rst)$/.test(base)) return "docs";
    if (/(^|\/)(tests?|__tests__|spec)\//.test(path) || /^test_|_test\.|\.test\.|\.spec\./.test(base)) return "tests";
    if (/^(package\.json|requirements.*\.txt|pyproject\.toml|setup\.(py|cfg)|pipfile|cargo\.toml|go\.mod|pom\.xml|build\.gradle|composer\.json|gemfile|dockerfile|docker-compose\.ya?ml|makefile|procfile|tsconfig.*\.json|\.gitignore|\.env\.example|\.dockerignore|\.editorconfig|vite\.config\..*|webpack\.config\..*|\.eslintrc.*|\.prettierrc.*)$/.test(base) || /^\.github\//.test(path)) return "setup";
    return "code";
  }

  /**
   * Convert a chat reply to manifest text.
   * Returns {text, files:[paths], skipped: number of code blocks without a file name}
   */
  function convertChatReply(reply, projectHint) {
    const lines = String(reply).replace(/\r\n?/g, "\n").split("\n");
    const files = new Map();
    let skipped = 0, project = projectHint || null;

    for (let i = 0; i < lines.length; i++) {
      const open = lines[i].match(/^(\s*)(```+|~~~+)\s*([^\s`]*)\s*(.*)$/);
      if (!open) {
        if (!project) {
          const h = lines[i].match(/^#\s+([A-Za-z0-9._ -]{2,60})\s*$/);
          if (h) project = h[1];
        }
        continue;
      }
      const fence = open[2], indent = open[1].length;
      let lang = open[3], info = open[4];
      const body = [];
      let j = i + 1;
      for (; j < lines.length; j++) {
        if (lines[j].trim().startsWith(fence) && lines[j].trim().replace(/[`~]/g, "") === "") break;
        body.push(indent ? lines[j].replace(new RegExp("^ {0," + indent + "}"), "") : lines[j]);
      }
      // find the file name: ```python app.py  |  label just above  |  comment on first line
      let path = null;
      if (info) path = fileFromLabel(info);
      if (!path && lang && lang.includes(".")) path = fileFromLabel(lang.replace(/^.*:/, ""));
      if (!path) {
        for (let k = i - 1, seen = 0; k >= 0 && seen < 2; k--) {
          if (!lines[k].trim()) continue;
          seen++;
          path = fileFromLabel(lines[k]);
          if (path) break;
        }
      }
      if (!path && body.length) {
        const fl = fileFromFirstLine(body[0]);
        if (fl) { path = fl; body.shift(); }
      }
      const shellLang = /^(bash|sh|shell|console|zsh|powershell|ps|cmd|terminal)$/i.test(lang || "");
      const isCommands = shellLang && !/\.(sh|bash|ps1|cmd|bat)$/i.test(path || "");
      if (path && !isCommands) {
        try { path = safePath(path); files.set(path, body.join("\n").replace(/\n+$/, "") + "\n"); }
        catch { skipped++; }
      } else {
        skipped++;
      }
      i = j;
    }

    if (!files.size) throw new ManifestError("Couldn't find any files in this reply. Each code block needs a file name just above it (like **app.py**).");
    return { text: serialize(manifestFromFiles(files, project)), files: [...files.keys()], skipped };
  }

  const slug = s => String(s || "").trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100) || "my-project";

  /** Group paths into commits in build order: setup, code by top folder, tests, docs. */
  function groupCommits(paths) {
    const groups = { setup: [], tests: [], docs: [] };
    const codeGroups = new Map();
    for (const p of paths) {
      const kind = classify(p);
      if (kind === "code") {
        const top = p.includes("/") ? p.split("/")[0] : "";
        if (!codeGroups.has(top)) codeGroups.set(top, []);
        codeGroups.get(top).push(p);
      } else groups[kind].push(p);
    }
    const plan = [];
    if (groups.setup.length) plan.push(["Set up project configuration", groups.setup]);
    for (const [top, ps] of codeGroups) plan.push([top ? `Add ${top} code` : "Add core code", ps]);
    if (groups.tests.length) plan.push(["Add tests", groups.tests]);
    if (groups.docs.length) plan.push(["Add documentation", groups.docs]);
    return plan;
  }

  /** Build a manifest from a Map(path -> text), grouping files into sensible commits. */
  function manifestFromFiles(files, project) {
    return {
      project: slug(project),
      commits: groupCommits([...files.keys()]).map(([message, ps]) => ({ message, files: new Map(ps.map(p => [p, files.get(p)])) })),
    };
  }

  /**
   * Apply a change manifest (only the files that changed) to a manifest.
   * inPlace: rewrite files inside the commits that already hold them (a project that isn't pushed yet);
   * otherwise the change is appended as new commits (it reads as history).
   */
  function applyChanges(m, change, opts) {
    const commits = m.commits.map(c => ({ message: c.message, files: new Map(c.files) }));
    if (!(opts && opts.inPlace)) {
      return { project: m.project, commits: commits.concat(change.commits.map(c => ({ message: c.message, files: new Map(c.files) }))) };
    }
    const last = commits[commits.length - 1];
    change.commits.forEach(c => c.files.forEach((v, p) => {
      if (v === null) { commits.forEach(cm => cm.files.delete(p)); return; }
      let owner = null;
      commits.forEach(cm => { if (cm.files.has(p)) owner = cm; });
      (owner || last).files.set(p, v);
    }));
    const kept = commits.filter(c => c.files.size);
    return { project: m.project, commits: kept.length ? kept : commits.slice(0, 1) };
  }

  /** What changed between two Map(path -> text) snapshots. */
  function changedPaths(before, after) {
    const added = [], changed = [], deleted = [];
    after.forEach((v, p) => { if (!before.has(p)) added.push(p); else if (before.get(p) !== v) changed.push(p); });
    before.forEach((_, p) => { if (!after.has(p)) deleted.push(p); });
    return { added, changed, deleted };
  }

  // ------------------------------------------------------------------ open an existing project
  const IMPORT_LIMITS = { files: 300, fileBytes: 200 * 1024, totalBytes: 3 * 1024 * 1024 };
  const SKIP_DIRS = /(^|\/)(node_modules|\.git|dist|build|out|target|venv|\.venv|env|__pycache__|\.next|\.nuxt|\.cache|coverage|\.idea|\.vscode|\.pytest_cache|\.mypy_cache|\.gradle|bin|obj|vendor)(\/|$)/;
  const BINARY = /\.(png|jpe?g|gif|webp|bmp|ico|icns|svgz|pdf|zip|gz|tgz|bz2|xz|7z|rar|tar|jar|war|class|exe|dll|so|dylib|o|a|lib|woff2?|ttf|otf|eot|mp3|mp4|m4a|mov|avi|wav|ogg|webm|pyc|pyo|db|sqlite3?|bin|dat|psd|ai|sketch|fig|xlsx?|docx?|pptx?|keystore|p12|pfx)$/i;
  /** Why a file is left out of an import, or null to include it. */
  function skipReason(path, size) {
    if (SKIP_DIRS.test(path)) return "folder";
    if (BINARY.test(path) || /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|poetry\.lock|Cargo\.lock|\.DS_Store)$/.test(path)) return "binary";
    if (size > IMPORT_LIMITS.fileBytes) return "large";
    try { safePath(path); } catch { return "path"; }
    return null;
  }

  // ------------------------------------------------------------------ plan → approve → write
  /**
   * Validate a project plan (from the AI or the plan editor).
   * Returns {project, summary, commits:[{message, files:[{path, purpose}]}]}; throws ManifestError.
   */
  function normalizePlan(p, maxFiles) {
    if (!p || typeof p !== "object") throw new ManifestError("The plan is empty.");
    const seen = new Set();
    const commits = (Array.isArray(p.commits) ? p.commits : []).map(c => ({
      message: String((c && c.message) || "").trim().slice(0, 120),
      files: (Array.isArray(c && c.files) ? c.files : []).map(f => typeof f === "string" ? { path: f } : f || {})
        .map(f => ({ path: String(f.path || "").trim(), purpose: String(f.purpose || "").trim().slice(0, 200) }))
        .filter(f => f.path)
        .map(f => ({ ...f, path: safePath(f.path) }))
        .filter(f => !seen.has(f.path) && seen.add(f.path)),
    })).filter(c => c.files.length);
    if (!commits.length) throw new ManifestError("The plan has no files.");
    commits.forEach((c, i) => { if (!c.message) c.message = `Add part ${i + 1}`; });
    if (seen.size > (maxFiles || 25)) throw new ManifestError(`The plan has ${seen.size} files. Keep it to ${maxFiles || 25} or fewer.`);
    const project = String(p.project || "").trim();
    return { project: PROJECT_NAME.test(project) ? project : slug(project), summary: String(p.summary || "").trim().slice(0, 300), commits };
  }

  /** Rearrange written files into the approved plan's commits. Extra files go into the last commit. */
  function fitToPlan(m, plan) {
    const files = finalFiles(m), used = new Set();
    const commits = plan.commits.map(c => {
      const fm = new Map();
      c.files.forEach(f => { if (files.has(f.path)) { fm.set(f.path, files.get(f.path)); used.add(f.path); } });
      return { message: c.message, files: fm };
    });
    const extra = [...files.keys()].filter(p => !used.has(p));
    extra.forEach(p => commits[commits.length - 1].files.set(p, files.get(p)));
    const missing = plan.commits.flatMap(c => c.files.map(f => f.path)).filter(p => !files.has(p));
    return { m: { project: plan.project || m.project, commits: commits.filter(c => c.files.size) }, missing, extra };
  }

  // ------------------------------------------------------------------ project type
  /** Language, entry point and commands of a project, from its files. */
  function detectStack(files) {
    const paths = [...files.keys()];
    const base = p => p.split("/").pop();
    const has = re => paths.some(p => re.test(p));
    const html = paths.find(p => base(p).toLowerCase() === "index.html") || paths.find(p => /\.html?$/i.test(p)) || null;
    const out = { lang: "other", web: !!html, html, tests: false, entry: null, run: null, test: null, install: null };
    if (has(/\.py$/)) {
      out.lang = "python";
      out.tests = paths.some(p => /\.py$/.test(p) && (/^test_|_test\.py$/.test(base(p)) || /(^|\/)tests?\//.test(p)));
      const py = paths.filter(p => /\.py$/.test(p) && !/^test_|_test\.py$|^conftest\.py$/.test(base(p)) && !/(^|\/)tests?\//.test(p));
      out.entry = ["main.py", "app.py", "cli.py", "run.py", "manage.py"].find(n => py.includes(n))
        || py.find(p => /if __name__ == ["']__main__["']/.test(files.get(p) || "")) || py[0] || null;
      if (out.entry) out.run = `python ${out.entry}`;
      if (out.tests) out.test = "python -m pytest";
      if (files.has("requirements.txt")) out.install = "pip install -r requirements.txt";
    } else if (files.has("package.json")) {
      out.lang = "node";
      let pkg = {};
      try { pkg = JSON.parse(files.get("package.json")) || {}; } catch {}
      const sc = pkg.scripts || {};
      out.install = "npm install";
      if (sc.test && !/no test specified/.test(sc.test)) { out.test = "npm test"; out.tests = true; }
      out.run = sc.start ? "npm start" : sc.dev ? "npm run dev" : pkg.main ? `node ${pkg.main}` : files.has("index.js") ? "node index.js" : null;
    } else if (files.has("go.mod")) {
      out.lang = "go"; out.run = "go run ."; out.test = "go test ./..."; out.tests = has(/_test\.go$/);
    } else if (has(/\.java$/)) {
      out.lang = "java"; out.tests = has(/Test\.java$/);
      if (files.has("pom.xml")) { out.test = "mvn test"; out.install = "mvn -q compile"; }
    } else if (has(/\.(c|m)?js$/) && !html) {
      out.lang = "node";
      const js = paths.filter(p => /\.(c|m)?js$/.test(p));
      out.entry = ["index.js", "main.js", "app.js"].find(n => js.includes(n)) || js[0];
      out.run = `node ${out.entry}`;
    } else if (has(/\.(cpp|cc|cxx)$/)) {
      out.lang = "cpp"; out.run = "g++ -o program *.cpp && ./program";
    } else if (has(/\.c$/)) {
      out.lang = "c"; out.run = "gcc -o program *.c && ./program";
    } else if (html) {
      out.lang = "web"; out.run = `open ${html} in a browser`;
    }
    return out;
  }

  // ------------------------------------------------------------------ repo polish pack
  const GITIGNORE = {
    python: "__pycache__/\n*.py[cod]\n.venv/\nvenv/\n.env\n.pytest_cache/\ndist/\nbuild/\n*.egg-info/\n",
    node: "node_modules/\ndist/\nbuild/\n.env\nnpm-debug.log*\ncoverage/\n",
    go: "/bin/\n*.exe\n*.test\ncoverage.out\n.env\n",
    java: "target/\n*.class\n.idea/\n*.iml\n.env\n",
    web: ".DS_Store\n.env\nnode_modules/\n",
    other: ".DS_Store\n.env\n",
  };

  function ciWorkflow(st, files) {
    const head = "name: CI\n\non:\n  push:\n  pull_request:\n\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v5\n";
    if (st.lang === "python") {
      return head + "      - uses: actions/setup-python@v6\n        with:\n          python-version: \"3.12\"\n" +
        "      - run: pip install pytest" + (files.has("requirements.txt") ? " -r requirements.txt" : "") + "\n" +
        (st.tests ? "      - run: python -m pytest\n" : `      - run: python -m py_compile ${[...files.keys()].filter(p => /\.py$/.test(p)).join(" ")}\n`);
    }
    if (st.lang === "node") {
      return head + "      - uses: actions/setup-node@v5\n        with:\n          node-version: 22\n" +
        `      - run: ${files.has("package-lock.json") ? "npm ci" : "npm install"}\n` + (st.test ? "      - run: npm test\n" : "");
    }
    if (st.lang === "go") return head + "      - uses: actions/setup-go@v6\n        with:\n          go-version: stable\n      - run: go build ./...\n      - run: go test ./...\n";
    if (st.lang === "java" && files.has("pom.xml")) return head + "      - uses: actions/setup-java@v5\n        with:\n          distribution: temurin\n          java-version: \"21\"\n      - run: mvn -B test\n";
    return null;
  }

  function agentsMd(m, files, st) {
    const readme = files.get("README.md") || "";
    const summary = (readme.split("\n").find(l => l.trim() && !/^#|^!\[|^\[!/.test(l.trim())) || "").trim();
    const kind = { code: "code", tests: "tests", docs: "docs", setup: "setup" };
    return [
      "# AGENTS.md", "",
      "Guidance for AI coding tools (Claude Code, Codex, Cursor and others) working in this repository.", "",
      "## Project", "",
      `**${m.project}**${summary ? ": " + summary : ""}`, "",
      "## Layout", "",
      ...[...files.keys()].sort().map(p => `- \`${p}\` (${kind[classify(p)]})`), "",
      "## Commands", "",
      ...(st.install ? [`- Install: \`${st.install}\``] : []),
      ...(st.run ? [`- Run: \`${st.run}\``] : []),
      ...(st.test ? [`- Test: \`${st.test}\``] : ["- Tests: none yet. Add them alongside new code."]), "",
      "## Rules", "",
      "- Keep changes small and match the existing style and file layout.",
      "- Add or update tests with every change, and run them before committing.",
      "- Never commit secrets. Read keys from environment variables.",
      "- Explain non-obvious decisions in the commit message.", "",
    ].join("\n");
  }

  const MIT = (year, who) => `MIT License

Copyright (c) ${year} ${who}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`;

  const ISSUE_BUG = "---\nname: Bug report\nabout: Something doesn't work\nlabels: bug\n---\n\n**What happened**\n\n**What you expected**\n\n**Steps to reproduce**\n1.\n2.\n\n**Environment** (OS, version)\n";
  const ISSUE_FEAT = "---\nname: Feature request\nabout: Suggest an idea\nlabels: enhancement\n---\n\n**The problem**\n\n**The idea**\n\n**Alternatives you considered**\n";

  /**
   * Repo polish pack as one extra commit, or null if nothing to add.
   * opts: {license, gitignore, issues, ci, agents, author, year, existing: Set of paths already on GitHub}
   */
  function polish(m, opts) {
    opts = opts || {};
    const files = finalFiles(m), st = detectStack(files);
    const skip = p => files.has(p) || (opts.existing && opts.existing.has(p));
    const add = new Map(), names = [];
    const put = (p, text, name) => { if (!skip(p) && text) { add.set(p, text); if (!names.includes(name)) names.push(name); } };
    if (opts.license) put("LICENSE", MIT(opts.year || new Date().getFullYear(), opts.author || "The authors"), "LICENSE");
    if (opts.gitignore) put(".gitignore", GITIGNORE[st.lang] || GITIGNORE.other, ".gitignore");
    if (opts.issues) {
      put(".github/ISSUE_TEMPLATE/bug_report.md", ISSUE_BUG, "issue templates");
      put(".github/ISSUE_TEMPLATE/feature_request.md", ISSUE_FEAT, "issue templates");
    }
    if (opts.ci) put(".github/workflows/ci.yml", ciWorkflow(st, files), "CI");
    if (opts.agents) {
      put("AGENTS.md", agentsMd(m, files, st), "AGENTS.md");
      put("CLAUDE.md", "# CLAUDE.md\n\nProject instructions for Claude Code live in AGENTS.md so every AI tool shares them.\n\n@AGENTS.md\n", "CLAUDE.md");
    }
    if (!add.size) return null;
    return { message: "Add " + names.join(", "), files: add };
  }

  // ------------------------------------------------------------------ understanding check
  /** Short stable fingerprint of a project's final files (FNV-1a), to tie a quiz score to one version. */
  // the README's own "Understanding check" section doesn't count, so adding the score keeps the pass
  const UNDERSTANDING = /\n?## Understanding check\n[\s\S]*?(?=\n## |$)/;
  function fingerprint(m) {
    let h = 0x811c9dc5;
    const s = [...finalFiles(m)].sort((a, b) => a[0] < b[0] ? -1 : 1)
      .map(([p, c]) => p + "\0" + (p === "README.md" ? c.replace(UNDERSTANDING, "").replace(/\n*$/, "\n") : c)).join("\0");
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h.toString(16).padStart(8, "0");
  }

  /** README text with an "Understanding check" section added or replaced. r = {kind, score, total, date, login} */
  function withUnderstanding(readme, r) {
    const section = [
      "## Understanding check", "",
      `${r.login ? "@" + r.login : "The author"} answered ${r.kind === "interview" ? "a mock interview" : "a quiz"} about this code with [STEJECT](https://github.com/aadvik7/Steject) ` +
      `and scored **${r.score}/${r.total}** (${r.date}).`, "",
    ].join("\n");
    const text = String(readme || "").replace(UNDERSTANDING, "").replace(/\n*$/, "\n");
    return text.trim() ? text + "\n" + section : section;
  }

  /** Does this text look like a manifest (vs a normal chat reply)? */
  function looksLikeManifest(text) {
    return /^=== (PROJECT|FILE): .+ ===\s*$/m.test(text);
  }

  // A plain-words hint for pasted text that is neither a manifest nor a chat reply
  // with code blocks (usually code copied without its file names). null = no hint.
  function pasteHint(text) {
    const t = String(text || "");
    if (!t.trim() || looksLikeManifest(t) || /```|~~~/.test(t)) return null;
    const codey = /^\s*(import |from \S+ import |def |class |function |const |let |var |#include|public |package |using |<\/?[a-z][a-z0-9]*[ >])/m.test(t);
    if (codey) return "This looks like code with no file names, so STEJECT can't tell which file it belongs to. In the chat, use the Copy button under the whole reply (not select-and-drag), or use the prompt above so the AI answers in the right format.";
    return "This doesn't look like a project yet. Paste the AI's whole reply, or use the prompt above. No project yet? Use \"Start from an idea\".";
  }

  // ------------------------------------------------------------------ diff (Myers)
  function diffLines(a, b) {
    const A = a === "" ? [] : a.replace(/\n$/, "").split("\n");
    const B = b === "" ? [] : b.replace(/\n$/, "").split("\n");
    const N = A.length, M = B.length, max = N + M;
    if (max > 20000) return [{ t: "!", s: "File too large to compare." }];
    const v = new Map([[1, 0]]), trace = [];
    outer:
    for (let d = 0; d <= max; d++) {
      trace.push(new Map(v));
      for (let k = -d; k <= d; k += 2) {
        let x = (k === -d || (k !== d && (v.get(k - 1) ?? -1) < (v.get(k + 1) ?? -1))) ? (v.get(k + 1) ?? 0) : (v.get(k - 1) ?? 0) + 1;
        let y = x - k;
        while (x < N && y < M && A[x] === B[y]) { x++; y++; }
        v.set(k, x);
        if (x >= N && y >= M) break outer;
      }
    }
    // backtrack
    const ops = [];
    let x = N, y = M;
    for (let d = trace.length - 1; d >= 0; d--) {
      const vv = trace[d], k = x - y;
      const prevK = (k === -d || (k !== d && (vv.get(k - 1) ?? -1) < (vv.get(k + 1) ?? -1))) ? k + 1 : k - 1;
      const prevX = vv.get(prevK) ?? 0, prevY = prevX - prevK;
      while (x > prevX && y > prevY) { ops.push({ t: " ", s: A[x - 1] }); x--; y--; }
      if (d > 0) { if (x === prevX) ops.push({ t: "+", s: B[y - 1] }); else ops.push({ t: "-", s: A[x - 1] }); }
      x = prevX; y = prevY;
    }
    return ops.reverse();
  }

  /** A readable diff of two Map(path -> text) snapshots ("+ added line", "- removed line"), for prompts and PR text. */
  function changeDiff(before, after, max) {
    const ch = changedPaths(before, after), out = [];
    ch.added.forEach(p => out.push(`--- new file ${p}`, ...String(after.get(p)).replace(/\n$/, "").split("\n").map(l => "+ " + l)));
    ch.changed.forEach(p => {
      out.push(`--- ${p}`);
      diffLines(before.get(p) || "", after.get(p) || "").forEach(o => { if (o.t === "+" || o.t === "-") out.push(o.t + " " + o.s); else if (o.t === "!") out.push("(file too large to compare)"); });
    });
    ch.deleted.forEach(p => out.push(`--- deleted ${p}`));
    const text = out.join("\n");
    return max && text.length > max ? text.slice(0, max) + "\n…(cut)" : text;
  }

  function diffSummary(ops) {
    let add = 0, del = 0;
    ops.forEach(o => { if (o.t === "+") add++; else if (o.t === "-") del++; });
    return { add, del };
  }

  // ------------------------------------------------------------------ offline ship script
  const sq = s => "'" + String(s).replace(/'/g, "'\\''") + "'";
  const clean = s => (s || "").replace(/["$`\\\n]/g, "");
  const fileMode = path => /\.(sh|bash)$/.test(path) || /^bin\//.test(path) ? "100755" : "100644";

  function buildScript(m, opts) {
    opts = opts || {};
    const L = [];
    L.push("#!/usr/bin/env bash");
    L.push("# STEJECT ship kit for " + m.project + ". Run: bash ship.sh");
    L.push("set -euo pipefail");
    L.push("PROJECT=" + sq(m.project));
    L.push('REMOTE="${1:-' + clean(opts.remote) + '}"');
    L.push('TG_TOKEN="${TELEGRAM_BOT_TOKEN:-' + clean(opts.tgToken) + '}"');
    L.push('TG_CHAT="${TELEGRAM_CHAT_ID:-' + clean(opts.tgChat) + '}"');
    L.push("");
    L.push('notify() {');
    L.push('  if [ -n "$TG_TOKEN" ] && [ -n "$TG_CHAT" ] && command -v curl >/dev/null 2>&1; then');
    L.push('    curl -s -m 10 -X POST "https://api.telegram.org/bot${TG_TOKEN}/sendMessage" \\');
    L.push('      --data-urlencode "chat_id=${TG_CHAT}" --data-urlencode "text=$1" >/dev/null || true');
    L.push('  fi');
    L.push('}');
    L.push('fail() { echo "ERROR: $1" >&2; notify "STEJECT failed: $PROJECT - $1"; exit 1; }');
    L.push('trap \'fail "a command failed on line $LINENO"\' ERR');
    L.push("");
    L.push('command -v git >/dev/null 2>&1 || fail "git is not installed"');
    L.push('git config user.name >/dev/null || fail "set your name first: git config --global user.name \\"Your Name\\""');
    L.push('git config user.email >/dev/null || fail "set your email first: git config --global user.email you@example.com"');
    L.push('if [ -e "$PROJECT" ] && [ -n "$(ls -A "$PROJECT" 2>/dev/null)" ]; then fail "folder $PROJECT already exists and is not empty"; fi');
    L.push('mkdir -p "$PROJECT"');
    L.push('cd "$PROJECT"');
    L.push('git init -q');
    L.push('git checkout -q -b main 2>/dev/null || git symbolic-ref HEAD refs/heads/main');
    L.push("");
    let total = 0;
    m.commits.forEach((c, ci) => {
      L.push(`# ---- commit ${ci + 1}/${m.commits.length}: ${clean(c.message)}`);
      c.files.forEach((content, path) => {
        if (content === null) { L.push("rm -f " + sq(path)); return; }
        total++;
        const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
        if (dir) L.push("mkdir -p " + sq(dir));
        if (!content) { L.push(": > " + sq(path)); return; }
        let tag;
        do { tag = "STE_EOF_" + Math.random().toString(36).slice(2, 10).toUpperCase(); }
        while (content.split("\n").includes(tag));
        L.push("cat > " + sq(path) + " <<'" + tag + "'");
        L.push(content.replace(/\n$/, ""));
        L.push(tag);
        if (fileMode(path) === "100755") L.push("chmod +x " + sq(path));
      });
      L.push("git add -A");
      L.push("git commit -q --allow-empty -m " + sq(c.message));
      L.push(`echo "  committed: ${clean(c.message)}"`);
      L.push("");
    });
    L.push('if [ -n "$REMOTE" ]; then');
    L.push('  git remote add origin "$REMOTE"');
    L.push('  git push -u origin main');
    L.push(`  echo "Done: ${m.commits.length} commit(s) pushed to $REMOTE"`);
    L.push(`  notify "STEJECT shipped $PROJECT: ${m.commits.length} commit(s), ${total} file(s) pushed to $REMOTE"`);
    L.push('else');
    L.push(`  echo "Done: ${m.commits.length} commit(s) created in $(pwd). Add a remote and push when ready."`);
    L.push(`  notify "STEJECT built $PROJECT locally: ${m.commits.length} commit(s)"`);
    L.push('fi');
    return L.join("\n") + "\n";
  }

  // ------------------------------------------------------------------ misc
  /** Pull the first JSON object/array out of model output. */
  function extractJson(text) {
    const s = String(text).replace(/```(?:json)?/gi, "");
    const start = s.search(/[\[{]/);
    if (start < 0) throw new Error("No JSON found");
    for (let end = s.length; end > start; end--) {
      const ch = s[end - 1];
      if (ch !== "}" && ch !== "]") continue;
      try { return JSON.parse(s.slice(start, end)); } catch {}
    }
    throw new Error("Could not read JSON");
  }

  /** Compact project digest for prompts, within a character budget. */
  function digest(m, budget) {
    budget = budget || 12000;
    const files = finalFiles(m);
    const tree = [...files.keys()].map(p => "- " + p).join("\n");
    let out = `Project: ${m.project}\nFiles:\n${tree}\n`;
    const per = Math.max(400, Math.floor((budget - out.length) / Math.max(1, files.size)));
    for (const [p, c] of files) {
      if (out.length > budget) break;
      const body = c.length > per ? c.slice(0, per) + "\n…(truncated)" : c;
      out += `\n--- ${p} ---\n${body}`;
    }
    return out.slice(0, budget + 2000);
  }

  const PROMPT_TEMPLATE = `Build me a complete project, and output it ONLY in the STEJECT manifest format below. No explanations outside the manifest.

FORMAT RULES (strict):
1. First line: === PROJECT: <folder-name> ===  (letters, numbers, - _ . only)
2. Every file starts with a line === FILE: <relative/path> === followed by the full file contents. Never write "..." or "rest of the code here". Write every file completely.
3. After the files that belong together, add a line === COMMIT: <short commit message> ===. Split the project into 4 to 8 logical commits (setup, core logic, tests, docs). Every file must come before the COMMIT line it belongs to.
4. To remove a file in an update, write === DELETE: <path> === before the COMMIT line.
5. Include a README.md with: what it does, how to install, how to run, and a short "how it works" section.
6. Include at least one test file if the language supports it.
7. Never include real API keys, passwords or tokens. Use environment variables and a .env.example.
8. Use relative paths only. No absolute paths, no "..".
9. Put the whole manifest in ONE code block.

EXAMPLE:
=== PROJECT: hello-app ===
=== FILE: app.py ===
print("hello")
=== COMMIT: Add main script ===
=== FILE: README.md ===
# hello-app
Prints hello.
=== COMMIT: Add README ===

MY PROJECT:
<describe what you want built here>`;

  const UPDATE_PROMPT = `Here is my current project. Make the change I describe below and output ONLY the files you add or change, in the STEJECT manifest format (=== FILE: path === blocks followed by === COMMIT: message === lines; use === DELETE: path === to remove a file). Write every changed file completely. Keep the same === PROJECT: name === line.

CHANGE I WANT:
<describe the change here>`;

  return {
    ManifestError, parse, serialize, finalFiles, stats, scanSecrets, isPlaceholderSecret, safePath,
    convertChatReply, looksLikeManifest, pasteHint, classify,
    skipReason, IMPORT_LIMITS, groupCommits, manifestFromFiles, normalizePlan, fitToPlan, applyChanges, changedPaths, detectStack, polish, fingerprint, withUnderstanding, slug,
    diffLines, diffSummary, changeDiff, buildScript, fileMode, extractJson, digest,
    PROMPT_TEMPLATE, UPDATE_PROMPT, SECRETS,
  };
});
