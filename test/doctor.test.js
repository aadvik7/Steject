// Tests for app/js/doctor.js (Repo doctor). Run: npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const D = require("../app/js/doctor.js");

const repo = (files, extraTree) => {
  const map = new Map(Object.entries(files));
  return { files: map, tree: [...map.keys()].map(p => ({ path: p, size: map.get(p).length })).concat(extraTree || []) };
};
const ids = r => Object.fromEntries(r.items.map(i => [i.id, i.ok]));

test("a bare repo scores low and every problem has a plain explanation", () => {
  const r = D.diagnose(repo({ "main.py": "print('hi')\n" }));
  assert.ok(r.score < 50 && r.grade === "Needs a lot of work", String(r.score));
  assert.deepEqual(ids(r), { readme: false, license: false, gitignore: false, junk: true, tests: false, ci: false, big: true, secrets: true, structure: true });
  assert.ok(r.items.every(i => i.detail.length > 10));
  assert.deepEqual(r.items.filter(i => i.fix).map(i => i.fix), ["readme", "license", "gitignore", "tests", "ci"]);
});

test("a healthy repo scores high", () => {
  const readme = "# todo\n\nA to-do list for the terminal.\n\n## Install\npip install -r requirements.txt\n\n## Usage\npython cli.py add milk\n\n## Tests\npython -m pytest\n" + "x".repeat(150);
  const r = D.diagnose({ ...repo({ "README.md": readme, "LICENSE": "MIT License", ".gitignore": "__pycache__/\n", "src/todo.py": "", "tests/test_todo.py": "", ".github/workflows/ci.yml": "name: CI", "requirements.txt": "requests==2.31.0\n" }), latest: { "pypi:requests": "2.32.3" } });
  assert.equal(r.score, 100);
  assert.equal(r.grade, "Excellent");
});

test("junk, big files, leaked secrets and stale dependencies are found", () => {
  const r = D.diagnose({
    ...repo({ "app.js": 'const k = "ghp_' + "a".repeat(36) + '";\n', "package.json": JSON.stringify({ dependencies: { express: "^3.0.0", lodash: "^4.17.0" } }) },
      [{ path: "node_modules/x/index.js", size: 10 }, { path: ".env", size: 20 }, { path: "video.mp4", size: 80 * 1048576 }]),
    latest: { "npm:express": "5.1.0", "npm:lodash": "4.17.21" },
  });
  const by = Object.fromEntries(r.items.map(i => [i.id, i]));
  assert.equal(by.junk.ok, false);
  assert.match(by.junk.detail, /node_modules\/x\/index\.js/);
  assert.match(by.junk.detail, /\.env usually means leaked passwords/);
  assert.deepEqual(r.junkIgnore.sort(), [".env", "node_modules/"]);
  assert.match(by.big.detail, /over 50 MB/);
  assert.match(by.secrets.detail, /GitHub token in app\.js line 1/);
  assert.match(by.deps.detail, /1 of 2 .* express \^3\.0\.0 → 5\.1\.0/);
});

test("README sections and messy structure", () => {
  const files = { "README.md": "# x\n\nsomething\n" };
  for (let i = 0; i < 14; i++) files[`f${i}.py`] = "";
  const r = D.diagnose(repo(files));
  const by = Object.fromEntries(r.items.map(i => [i.id, i]));
  assert.match(by["readme-sections"].detail, /how to install, how to run or use it, how to run the tests/);
  assert.equal(by.structure.ok, false);
});

test("dependency versions: major numbers and what to look up", () => {
  assert.equal(D.major("^4.17.21"), 4);
  assert.equal(D.major("~=2.1"), 2);
  assert.equal(D.major("*"), null);
  const files = new Map([["package.json", JSON.stringify({ dependencies: { a: "^1.0.0", b: "*", "@types/node": "^20.0.0", c: "github:x/c" } })], ["requirements.txt", "flask==3.0\nrequests\n"]]);
  assert.deepEqual(D.depsToCheck(files).map(d => `${d.eco}:${d.name}`), ["npm:a", "pypi:flask"]);
});
