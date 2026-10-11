// Tests for the starter gallery and the steject-starters validator — run: npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { validate } = require("../scripts/validate-starters.js");

const TEMPLATE = path.join(__dirname, "..", "templates", "steject-starters");

test("validator: the template repo is valid and produces an index entry", () => {
  const r = validate(TEMPLATE);
  assert.deepEqual(r.problems, []);
  assert.equal(r.starters.length, 1);
  assert.equal(r.starters[0].project, "starters/todo-cli/project.txt");
});

test("validator: a broken starter gets plain, specific problems", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "starters-"));
  const s = path.join(dir, "starters", "Bad_One");
  fs.mkdirSync(s, { recursive: true });
  fs.writeFileSync(path.join(s, "starter.json"), JSON.stringify({ id: "bad-one", title: "x".repeat(50), level: "expert", size: "huge", lang: "", idea: "short", learn: [] }));
  fs.writeFileSync(path.join(s, "project.txt"), "=== FILE: ../evil.py ===\nx = 1\n=== COMMIT: x ===");
  fs.writeFileSync(path.join(s, "README.md"), "# nothing");
  const { problems } = validate(dir);
  const all = problems.join("\n");
  for (const want of ["must match the folder name", "title", "level", "size", "lang is required", "idea", "learn", "doesn't parse", "What you'll learn"]) {
    assert.match(all, new RegExp(want.replace(/[.*+?^${}()|[\]\\']/g, "\\$&")), want);
  }
});

test("validator: projects without tests or with secrets are rejected", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "starters-"));
  const s = path.join(dir, "starters", "no-tests");
  fs.mkdirSync(s, { recursive: true });
  fs.writeFileSync(path.join(s, "starter.json"), JSON.stringify({ id: "no-tests", title: "No tests", level: "beginner", size: "small", lang: "Python", idea: "A small Python program that prints a greeting.", learn: ["printing"] }));
  fs.writeFileSync(path.join(s, "project.txt"), '=== PROJECT: no-tests ===\n=== FILE: main.py ===\nkey = "ghp_' + "a".repeat(36) + '"\n=== COMMIT: a ===\n=== FILE: README.md ===\n# x\n=== COMMIT: b ===');
  fs.writeFileSync(path.join(s, "README.md"), "## What you'll learn\n## Difficulty\n## Run it\n## Test it\n");
  const all = validate(dir).problems.join("\n");
  assert.match(all, /needs at least one test file/);
  assert.match(all, /possible GitHub token/);
});

test("built-in gallery follows the same rules", () => {
  global.self = {};
  require("../app/starters/starters.js");
  const list = global.self.STE_STARTERS;
  assert.ok(list.length >= 15);
  const ids = new Set();
  for (const s of list) {
    assert.ok(/^[a-z0-9]+(-[a-z0-9]+)*$/.test(s.id), s.id);
    assert.ok(!ids.has(s.id), "duplicate " + s.id); ids.add(s.id);
    assert.ok(["beginner", "intermediate", "advanced"].includes(s.level), s.id);
    assert.ok(["small", "medium"].includes(s.size), s.id);
    assert.ok(s.title.length <= 40 && s.idea.length <= 400, s.id);
  }
});
