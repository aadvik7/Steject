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
