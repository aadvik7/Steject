// Unit tests for app/js/core.js — run: node --test test/
const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../app/js/core.js");

const SAMPLE = `\`\`\`
=== PROJECT: hello-app ===
=== FILE: app.py ===
print("hi")
=== COMMIT: Add app ===
=== FILE: README.md ===
# hello
=== FILE: empty.txt ===
=== COMMIT: Add docs ===
\`\`\``;

test("parses fenced manifest", () => {
  const m = C.parse(SAMPLE);
  assert.equal(m.project, "hello-app");
  assert.deepEqual(m.commits.map(c => c.message), ["Add app", "Add docs"]);
  assert.equal(m.commits[0].files.get("app.py"), 'print("hi")\n');
  assert.equal(m.commits[1].files.get("empty.txt"), "");
});

test("DELETE marker", () => {
  const m = C.parse("=== FILE: a.txt ===\nx\n=== COMMIT: add ===\n=== DELETE: a.txt ===\n=== COMMIT: remove ===");
  assert.equal(m.commits[1].files.get("a.txt"), null);
  assert.equal(C.finalFiles(m).size, 0);
  assert.equal(C.stats(m).deletes, 1);
});

test("rejects unsafe paths and junk", () => {
  for (const bad of ["../x", "/etc/passwd", "a/../../b", ".git/config", "C:/x", "a\\b"])
    assert.throws(() => C.parse(`=== FILE: ${bad} ===\nx`), C.ManifestError, bad);
  assert.throws(() => C.parse("Sure! Here you go\n=== FILE: a ===\nx"), /outside a FILE block/);
  assert.throws(() => C.parse("\n\n"), /No FILE blocks/);
  assert.throws(() => C.parse("=== COMMIT: empty ==="), /no files before it/);
  assert.throws(() => C.parse("=== PROJECT: bad name ===\n=== FILE: a ===\nx"), /Bad project name/);
});

test("serialize round-trips", () => {
  const m = C.parse(SAMPLE + "\n");
  const again = C.parse(C.serialize(m));
  assert.equal(C.serialize(again), C.serialize(m));
  const m2 = C.parse("=== FILE: a ===\nx\n=== DELETE: b ===\n=== COMMIT: c ===");
  assert.equal(C.parse(C.serialize(m2)).commits[0].files.get("b"), null);
});

test("secret scan", () => {
  const hit = C.parse('=== FILE: c.py ===\nk = "ghp_' + "a".repeat(36) + '"');
  assert.equal(C.scanSecrets(hit)[0].name, "GitHub token");
  assert.equal(C.scanSecrets(C.parse(SAMPLE)).length, 0);
  const env = C.parse('=== FILE: .env.example ===\nAPI_KEY=your-key-here');
  assert.equal(C.scanSecrets(env).length, 0, "placeholders are fine");
  const keyed = (name, key) => assert.equal(C.scanSecrets(C.parse(`=== FILE: k.js ===\nconst k = process.env.K || ${key};`))[0]?.name, name);
  keyed("Groq API key", "gsk_" + "a1".repeat(26));
  keyed("Hugging Face token", "hf_" + "b2".repeat(17));
  keyed("npm token", "npm_" + "c3".repeat(18));
});

test("converts a typical ChatGPT reply", () => {
  const reply = [
    "# Todo CLI",
    "",
    "Here's a simple todo app.",
    "",
    "**requirements.txt**",
    "```",
    "click==8.1.7",
    "```",
    "",
    "### `todo/cli.py`",
    "```python",
    "import click",
    "",
    "@click.command()",
    "def main():",
    "    print('todo')",
    "```",
    "",
    "Create `tests/test_cli.py`:",
    "```python",
    "def test_ok():",
    "    assert True",
    "```",
    "",
    "```js",
    "// web/app.js",
    "console.log('x')",
    "```",
    "",
    "Install it with requirements.txt:",
    "```bash",
    "pip install -r requirements.txt",
    "```",
    "",
    "README.md",
    "```markdown",
    "# Todo",
    "```",
    "",
    "Some example output:",
    "```",
    "done",
    "```",
  ].join("\n");
  const r = C.convertChatReply(reply);
  assert.deepEqual(r.files.sort(), ["README.md", "requirements.txt", "tests/test_cli.py", "todo/cli.py", "web/app.js"].sort());
  assert.equal(r.skipped, 2, "install commands and sample output are skipped");
  const m = C.parse(r.text);
  assert.equal(m.project, "todo-cli");
  assert.deepEqual(m.commits.map(c => c.message), ["Set up project configuration", "Add todo code", "Add web code", "Add tests", "Add documentation"]);
  assert.equal(C.finalFiles(m).get("web/app.js"), "console.log('x')\n", "comment file name line is removed");
  assert.equal(C.finalFiles(m).get("todo/cli.py").split("\n")[0], "import click");
});

test("converter errors clearly with no files", () => {
  assert.throws(() => C.convertChatReply("```\nprint(1)\n```"), /Couldn't find any files/);
  assert.equal(C.looksLikeManifest(SAMPLE), true);
  assert.equal(C.looksLikeManifest("**app.py**\n```py\nx\n```"), false);
});

test("diff is a correct shortest edit script", () => {
  const rnd = (n, alpha) => Array.from({ length: n }, () => "abcdef"[Math.floor(Math.random() * alpha)]);
  const lcs = (a, b) => {
    const d = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
      d[i][j] = a[i - 1] === b[j - 1] ? d[i - 1][j - 1] + 1 : Math.max(d[i - 1][j], d[i][j - 1]);
    return d[a.length][b.length];
  };
  for (let t = 0; t < 400; t++) {
    const a = rnd(Math.floor(Math.random() * 25), 1 + (t % 5)), b = rnd(Math.floor(Math.random() * 25), 1 + (t % 5));
    const ops = C.diffLines(a.join("\n") + (a.length ? "\n" : ""), b.join("\n") + (b.length ? "\n" : ""));
    assert.deepEqual(ops.filter(o => o.t !== "+").map(o => o.s), a, "old side");
    assert.deepEqual(ops.filter(o => o.t !== "-").map(o => o.s), b, "new side");
    assert.equal(ops.filter(o => o.t === " ").length, lcs(a, b), "minimal");
  }
  assert.deepEqual(C.diffSummary(C.diffLines("a\nb\n", "a\nc\nd\n")), { add: 2, del: 1 });
});

test("extractJson handles chatter and fences", () => {
  assert.deepEqual(C.extractJson('Sure!\n```json\n{"a":[1,2]}\n```\nhope it helps'), { a: [1, 2] });
  assert.deepEqual(C.extractJson("[1, 2] trailing }"), [1, 2]);
});

test("digest stays within budget", () => {
  const big = "=== FILE: a.py ===\n" + "x = 1\n".repeat(5000) + "=== FILE: b.py ===\ny\n";
  const d = C.digest(C.parse(big), 3000);
  assert.ok(d.length < 5100);
  assert.ok(d.includes("- b.py"));
});

test("pasteHint explains code pasted without file names", () => {
  const C = require("../app/js/core.js");
  assert.match(C.pasteHint("import unittest\n\nfrom calculator import add\n"), /no file names/);
  assert.match(C.pasteHint("hello there, build me an app"), /Start from an idea/);
  assert.equal(C.pasteHint("```py\nx = 1\n```"), null);                       // chat reply: the converter handles it
  assert.equal(C.pasteHint("=== FILE: a.py ===\nx = 1\n"), null);              // already a manifest
  assert.equal(C.pasteHint("   "), null);
});

const proj = (files, name = "todo") => ({ project: name, commits: [{ message: "Add all", files: new Map(Object.entries(files)) }] });

test("plan: normalizes, rejects unsafe paths, dedupes", () => {
  const p = C.normalizePlan({ project: "My Todo!", commits: [
    { message: "Core", files: [{ path: "todo.py", purpose: "logic" }, "todo.py"] },
    { message: "", files: [{ path: "test_todo.py" }] },
    { message: "Empty", files: [] },
  ] });
  assert.equal(p.project, "my-todo");
  assert.deepEqual(p.commits.map(c => c.message), ["Core", "Add part 2"]);
  assert.equal(p.commits[0].files.length, 1);
  assert.throws(() => C.normalizePlan({ commits: [{ message: "x", files: ["../etc/passwd"] }] }), /Unsafe/);
  assert.throws(() => C.normalizePlan({ commits: [] }), /no files/);
});

test("plan: written files are fitted into the approved commits", () => {
  const plan = C.normalizePlan({ project: "todo", commits: [{ message: "Core", files: ["todo.py"] }, { message: "Docs", files: ["README.md", "LICENSE"] }] });
  const written = C.parse("=== FILE: README.md ===\n# t\n=== FILE: todo.py ===\nx=1\n=== FILE: extra.py ===\ny=2\n=== COMMIT: everything ===");
  const r = C.fitToPlan(written, plan);
  assert.deepEqual(r.m.commits.map(c => [c.message, [...c.files.keys()]]), [["Core", ["todo.py"]], ["Docs", ["README.md", "extra.py"]]]);
  assert.deepEqual(r.missing, ["LICENSE"]);
  assert.deepEqual(r.extra, ["extra.py"]);
});

test("applyChanges: append as commits, or rewrite in place", () => {
  const m = C.parse("=== FILE: a.py ===\n1\n=== COMMIT: A ===\n=== FILE: b.py ===\n2\n=== COMMIT: B ===");
  const ch = C.parse("=== FILE: a.py ===\n1 fixed\n=== FILE: c.py ===\n3\n=== DELETE: b.py ===\n=== COMMIT: Fix ===");
  const appended = C.applyChanges(m, ch);
  assert.deepEqual(appended.commits.map(c => c.message), ["A", "B", "Fix"]);
  const inPlace = C.applyChanges(m, ch, { inPlace: true });
  assert.deepEqual(inPlace.commits.map(c => [c.message, Object.fromEntries(c.files)]), [["A", { "a.py": "1 fixed\n" }], ["B", { "c.py": "3\n" }]]);
  assert.deepEqual(C.changedPaths(C.finalFiles(m), C.finalFiles(inPlace)), { added: ["c.py"], changed: ["a.py"], deleted: ["b.py"] });
  assert.equal(C.parse(C.serialize(m)).commits.length, 2, "original untouched");
});

test("detectStack: python, node, web", () => {
  const py = C.detectStack(C.finalFiles(proj({ "main.py": "if __name__ == '__main__':\n  pass\n", "test_main.py": "", "requirements.txt": "rich\n" })));
  assert.deepEqual([py.lang, py.entry, py.tests, py.test, py.install], ["python", "main.py", true, "python -m pytest", "pip install -r requirements.txt"]);
  const node = C.detectStack(C.finalFiles(proj({ "package.json": '{"scripts":{"test":"node --test","start":"node app.js"}}', "app.js": "" })));
  assert.deepEqual([node.lang, node.test, node.run], ["node", "npm test", "npm start"]);
  const js = C.detectStack(C.finalFiles(proj({ "main.js": "", "lib.js": "" })));
  assert.deepEqual([js.lang, js.entry], ["node", "main.js"]);
  const web = C.detectStack(C.finalFiles(proj({ "index.html": "<h1>x</h1>", "style.css": "" })));
  assert.deepEqual([web.lang, web.web, web.html], ["web", true, "index.html"]);
});

test("polish pack: only adds what's missing, picks files by language", () => {
  const m = proj({ "main.py": "print(1)\n", "test_main.py": "def test_x(): pass\n", "README.md": "# todo\n\nA to-do app.\n", ".gitignore": "x\n" });
  const c = C.polish(m, { license: true, gitignore: true, issues: true, ci: true, agents: true, author: "aadvik7", year: 2026, existing: new Set(["LICENSE"]) });
  const paths = [...c.files.keys()].sort();
  assert.deepEqual(paths, [".github/ISSUE_TEMPLATE/bug_report.md", ".github/ISSUE_TEMPLATE/feature_request.md", ".github/workflows/ci.yml", "AGENTS.md", "CLAUDE.md"]);
  assert.match(c.files.get(".github/workflows/ci.yml"), /setup-python[\s\S]*python -m pytest/);
  assert.match(c.files.get("AGENTS.md"), /A to-do app\.[\s\S]*Test: `python -m pytest`/);
  assert.match(c.files.get("CLAUDE.md"), /@AGENTS\.md/);
  assert.equal(C.polish(m, {}), null);
  assert.match(C.polish(proj({ "a.js": "" }), { license: true, author: "x", year: 2026 }).files.get("LICENSE"), /Copyright \(c\) 2026 x/);
});

test("understanding: fingerprint follows content; README section is replaced, not duplicated", () => {
  const a = proj({ "a.py": "1\n" }), b = proj({ "a.py": "2\n" });
  assert.equal(C.fingerprint(a), C.fingerprint(proj({ "a.py": "1\n" })));
  assert.notEqual(C.fingerprint(a), C.fingerprint(b));
  const r = { kind: "quiz", score: 4, total: 5, date: "2026-10-12", login: "aadvik7" };
  const once = C.withUnderstanding("# todo\n\nIntro\n\n## Run\npython main.py\n", r);
  const twice = C.withUnderstanding(once, { ...r, score: 5 });
  assert.equal((twice.match(/## Understanding check/g) || []).length, 1);
  assert.match(twice, /scored \*\*5\/5\*\*/);
  assert.match(twice, /## Run\npython main.py/);
  const withScore = proj({ "README.md": twice });
  assert.equal(C.fingerprint(withScore), C.fingerprint(proj({ "README.md": "# todo\n\nIntro\n\n## Run\npython main.py\n" })), "adding the score keeps the same fingerprint");
});
