/*
 * STEJECT classroom: assignment files and PROOF.md. No server: a teacher shares an
 * assignment file, a student builds the project, STEJECT adds PROOF.md to the repo,
 * and the teacher's Review screen checks PROOF.md against the real commits and
 * re-runs the checks. Pure functions; works in the browser (window.SteClass) and in Node.
 *
 * What the proof shows: which assignment and which commit it refers to (a SHA-256
 * fingerprint of the two), that the listed commits are really in the repo, and the check
 * results. What it can't show: who wrote the code. The understanding score is self-reported.
 */
(function (root, factory) {
  const api = factory(root.SteCore || (typeof require === "function" ? require("./core.js") : null));
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.SteClass = api;
})(typeof self !== "undefined" ? self : this, function (C) {
  "use strict";
  const FORMAT = 1;

  class AssignmentError extends Error {}

  /** Validate an assignment (parsed JSON). Returns a clean copy; throws AssignmentError with a plain message. */
  function readAssignment(a) {
    if (!a || typeof a !== "object" || a.steject_assignment !== FORMAT) throw new AssignmentError("This isn't a STEJECT assignment file (it needs \"steject_assignment\": 1).");
    const id = String(a.id || "").trim();
    if (!/^[A-Za-z0-9._-]{3,80}$/.test(id)) throw new AssignmentError("The assignment needs an id of 3 to 80 letters, numbers, - _ or . (for example cs101-week3).");
    const title = String(a.title || "").trim().slice(0, 120);
    if (!title) throw new AssignmentError("The assignment needs a title.");
    const files = (obj, what) => {
      const out = new Map();
      Object.entries(obj && typeof obj === "object" ? obj : {}).forEach(([p, t]) => {
        try { out.set(C.safePath(p), String(t)); } catch { throw new AssignmentError(`${what}: unsafe file path "${p}".`); }
      });
      return out;
    };
    const starter = a.starter || {};
    const checks = (Array.isArray(a.checks) ? a.checks : []).map((c, i) => ({
      name: String((c && c.name) || `Check ${i + 1}`).slice(0, 80),
      visible: !!(c && c.visible),
      files: files(c && c.files, `Check "${(c && c.name) || i + 1}"`),
    }));
    const rubric = (Array.isArray(a.rubric) ? a.rubric : []).map(r => ({ criterion: String((r && r.criterion) || "").slice(0, 200), points: Math.max(0, +((r && r.points) || 0)) })).filter(r => r.criterion);
    const minScore = a.gate && +a.gate.min > 0 && +a.gate.min <= 1 ? +a.gate.min : 0;
    return {
      id, title,
      brief: String(a.brief || "").slice(0, 20000),
      requirements: (Array.isArray(a.requirements) ? a.requirements : []).map(String).filter(Boolean).slice(0, 40),
      starter: { project: C.slug(starter.project || id), files: files(starter.files, "Starter files") },
      checks, rubric, gate: { min: minScore },
    };
  }

  /** Serialize an assignment for the teacher to share. */
  function writeAssignment(a) {
    const obj = m => Object.fromEntries(m);
    return JSON.stringify({
      steject_assignment: FORMAT, id: a.id, title: a.title, brief: a.brief, requirements: a.requirements,
      starter: { project: a.starter.project, files: obj(a.starter.files) },
      checks: a.checks.map(c => ({ name: c.name, visible: c.visible, files: obj(c.files) })),
      rubric: a.rubric, gate: a.gate,
    }, null, 2) + "\n";
  }

  /** The student's starting project: starter files plus the visible checks, as one commit. */
  function starterManifest(a) {
    const files = new Map(a.starter.files);
    a.checks.filter(c => c.visible).forEach(c => c.files.forEach((t, p) => files.set(p, t)));
    if (!files.size) files.set("README.md", `# ${a.title}\n\n${a.brief.split("\n")[0] || ""}\n`);
    return { project: a.starter.project, commits: [{ message: "Start from the assignment's starter files", files }] };
  }

  /** The project plus every check file (hidden ones too), for running the checks. */
  function withChecks(m, a) {
    const files = new Map();
    a.checks.forEach(c => c.files.forEach((t, p) => files.set(p, t)));
    return files.size ? C.applyChanges(m, { commits: [{ message: "Assignment checks", files }] }) : m;
  }

  async function sha256(text) {
    const cr = (typeof crypto !== "undefined" && crypto.subtle) ? crypto : (typeof require === "function" ? require("crypto").webcrypto : null);
    const buf = await cr.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
  }
  /** Ties a proof to one assignment and one commit. Anyone can compute it, so it proves "which", not "who". */
  const fingerprint = (assignmentId, workSha) => sha256(`steject-proof:${assignmentId}:${workSha}`);

  /**
   * PROOF.md text. p = {assignment: {id, title}, workSha, commits: [{sha, message}], check: {status, summary, hidden: n},
   *   understanding: {kind, score, total} | null, login, date, repo}
   */
  async function proofMarkdown(p) {
    const fp = await fingerprint(p.assignment.id, p.workSha);
    const data = {
      format: FORMAT, assignment: p.assignment.id, work_commit: p.workSha, fingerprint: fp,
      commits: p.commits.map(c => ({ sha: c.sha, message: c.message })),
      check: { status: p.check.status, summary: p.check.summary },
      understanding: p.understanding ? { kind: p.understanding.kind, score: p.understanding.score, total: p.understanding.total } : null,
      login: p.login || null, date: p.date,
    };
    const u = p.understanding;
    return [
      "# PROOF", "",
      `This repository is a submission for **${p.assignment.title}** (assignment \`${p.assignment.id}\`), made with [STEJECT](https://github.com/aadvik7/Steject).`, "",
      "## Work", "",
      `The work ends at commit \`${p.workSha.slice(0, 7)}\`. This file was added in the commit right after it.`, "",
      ...p.commits.map((c, i) => `${i + 1}. \`${c.sha.slice(0, 7)}\` ${c.message}`), "",
      "## Checks", "",
      `${p.check.status === "pass" ? "✅ Passed" : p.check.status === "fail" ? "❌ Failed" : "➖ Not run"}: ${p.check.summary}`, "",
      "## Understanding", "",
      u ? `${p.login ? "@" + p.login : "The student"} scored **${u.score}/${u.total}** on the ${u.kind === "interview" ? "mock interview" : "quiz"} about this code (self-reported).` : "No quiz or mock interview was taken for this version.", "",
      "## Fingerprint", "",
      "`" + fp + "`", "",
      "SHA-256 of the assignment id and the work commit. It shows which assignment and which commit this proof is about. It does not show who wrote the code. A teacher can check this file with STEJECT's Review screen.", "",
      "<!-- steject-proof " + JSON.stringify(data) + " -->", "",
    ].join("\n");
  }

  /** The machine-readable part of PROOF.md, or null. */
  function readProof(text) {
    const m = String(text || "").match(/<!-- steject-proof (\{[\s\S]*?\}) -->/);
    if (!m) return null;
    try { const d = JSON.parse(m[1]); return d && d.format === FORMAT ? d : null; } catch { return null; }
  }

  /**
   * Compare a proof with the real repo. facts = {proofText, proofCommit: {sha, parents: [sha]},
   *   history: [sha, ...] reachable from the work commit, recheck: {status, summary} | null}
   * Returns {ok, rows: [{label, ok, detail}], proof}
   */
  async function verify(a, facts) {
    const rows = [], add = (label, ok, detail) => rows.push({ label, ok, detail });
    const proof = readProof(facts.proofText);
    if (!proof) { add("PROOF.md", false, facts.proofText == null ? "No PROOF.md in the repo." : "PROOF.md is there but its data block is missing or damaged."); return { ok: false, rows, proof: null }; }
    add("Assignment", proof.assignment === a.id, proof.assignment === a.id ? a.title : `It's for "${proof.assignment}", not "${a.id}".`);
    const fp = await fingerprint(proof.assignment, proof.work_commit);
    add("Fingerprint", fp === proof.fingerprint, fp === proof.fingerprint ? "Matches the assignment and the work commit." : "Doesn't match: PROOF.md was edited by hand.");
    const pc = facts.proofCommit;
    const onTop = !!pc && (pc.parents || []).includes(proof.work_commit);
    add("PROOF.md commit", onTop, onTop ? `Added right after the work commit ${proof.work_commit.slice(0, 7)}.` : "PROOF.md wasn't added right after the commit it describes (later changes, or it was edited).");
    const hist = new Set(facts.history || []);
    const missing = (proof.commits || []).filter(c => !hist.has(c.sha));
    add("Commits", !missing.length && (proof.commits || []).length > 0, missing.length ? `${missing.length} listed commit(s) aren't in the repo's history.` : `${proof.commits.length} commit(s), all in the history.`);
    if (facts.recheck) {
      const same = facts.recheck.status === proof.check.status;
      add("Checks (re-run)", facts.recheck.status === "pass", `Claimed: ${proof.check.status}. Re-run now: ${facts.recheck.status} (${facts.recheck.summary})${same ? "" : ". They differ."}`);
    } else add("Checks (re-run)", null, `Claimed: ${proof.check.status}. Not re-run here.`);
    const u = proof.understanding;
    const min = a.gate.min ? Math.ceil(a.gate.min * (u ? u.total : 1)) : 0;
    add("Understanding", u ? (a.gate.min ? u.score >= min : true) : !a.gate.min, u ? `${u.score}/${u.total} on the ${u.kind === "interview" ? "mock interview" : "quiz"} (self-reported)${a.gate.min ? `; needs ${min}` : ""}.` : "None taken.");
    const ok = rows.every(r => r.ok !== false);
    return { ok, rows, proof };
  }

  return { FORMAT, AssignmentError, readAssignment, writeAssignment, starterManifest, withChecks, fingerprint, proofMarkdown, readProof, verify, sha256 };
});
