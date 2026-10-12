// Tests for app/js/classroom.js (assignment files and PROOF.md). Run: npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../app/js/core.js");
const K = require("../app/js/classroom.js");

const RAW = {
  steject_assignment: 1, id: "cs101-week3", title: "Week 3: a calculator", brief: "Build add().",
  requirements: ["add(a, b) returns the sum"],
  starter: { project: "calc", files: { "calc.py": "def add(a, b):\n    pass\n" } },
  checks: [
    { name: "Visible test", visible: true, files: { "test_visible.py": "from calc import add\ndef test_one(): assert add(1, 1) == 2\n" } },
    { name: "Hidden test", visible: false, files: { "test_hidden.py": "from calc import add\ndef test_neg(): assert add(-1, -1) == -2\n" } },
  ],
  rubric: [{ criterion: "Works", points: 10 }], gate: { min: 0.6 },
};

test("assignment: read, round-trip, and plain errors", () => {
  const a = K.readAssignment(RAW);
  assert.equal(a.id, "cs101-week3");
  assert.equal(a.checks[1].visible, false);
  assert.deepEqual(K.readAssignment(JSON.parse(K.writeAssignment(a))), a);
  assert.throws(() => K.readAssignment({ id: "x" }), /isn't a STEJECT assignment/);
  assert.throws(() => K.readAssignment({ ...RAW, id: "a b" }), /needs an id/);
  assert.throws(() => K.readAssignment({ ...RAW, starter: { files: { "../x": "" } } }), /unsafe file path/);
});

test("assignment: the student gets starter + visible checks; checks run with hidden ones too", () => {
  const a = K.readAssignment(RAW);
  const m = K.starterManifest(a);
  assert.deepEqual([...C.finalFiles(m).keys()].sort(), ["calc.py", "test_visible.py"]);
  const run = K.withChecks(m, a);
  assert.deepEqual([...C.finalFiles(run).keys()].sort(), ["calc.py", "test_hidden.py", "test_visible.py"]);
});

test("PROOF.md: readable, machine-checkable, and verified against the repo", async () => {
  const a = K.readAssignment(RAW);
  const work = "a".repeat(40), proofSha = "b".repeat(40);
  const text = await K.proofMarkdown({ assignment: a, workSha: work, commits: [{ sha: "c".repeat(40), message: "Start" }, { sha: work, message: "Implement add" }], check: { status: "pass", summary: "Tests pass" }, understanding: { kind: "quiz", score: 4, total: 5 }, login: "aadvik7", date: "2026-10-12" });
  assert.match(text, /# PROOF/);
  assert.match(text, /scored \*\*4\/5\*\* .*self-reported/);
  assert.match(text, /does not show who wrote the code/);
  const proof = K.readProof(text);
  assert.equal(proof.fingerprint, await K.fingerprint(a.id, work));

  const good = await K.verify(a, { proofText: text, proofCommit: { sha: proofSha, parents: [work] }, history: [work, "c".repeat(40)], recheck: { status: "pass", summary: "Tests pass" } });
  assert.equal(good.ok, true, JSON.stringify(good.rows));

  const edited = await K.verify(a, { proofText: text.replace(/"fingerprint":"[0-9a-f]+"/, `"fingerprint":"${"0".repeat(64)}"`), proofCommit: { sha: proofSha, parents: [work] }, history: [work, "c".repeat(40)] });
  assert.equal(edited.rows.find(r => r.label === "Fingerprint").ok, false);

  const later = await K.verify(a, { proofText: text, proofCommit: { sha: proofSha, parents: ["d".repeat(40)] }, history: [work], recheck: { status: "fail", summary: "1 failed" } });
  const by = Object.fromEntries(later.rows.map(r => [r.label, r]));
  assert.equal(later.ok, false);
  assert.equal(by["PROOF.md commit"].ok, false);
  assert.match(by.Commits.detail, /1 listed commit/);
  assert.match(by["Checks (re-run)"].detail, /Claimed: pass\. Re-run now: fail .*They differ/);

  const none = await K.verify(a, { proofText: null });
  assert.match(none.rows[0].detail, /No PROOF\.md/);
  const wrong = await K.verify({ ...a, id: "other" }, { proofText: text, proofCommit: { parents: [work] }, history: [work, "c".repeat(40)] });
  assert.match(wrong.rows.find(r => r.label === "Assignment").detail, /not "other"/);
});
