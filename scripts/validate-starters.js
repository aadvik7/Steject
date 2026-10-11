#!/usr/bin/env node
// Validates a steject-starters folder (spec: docs/STARTERS-REPO.md) with the real STEJECT parser.
//   node scripts/validate-starters.js <repo-dir> [--index] [--core path/to/core.js]
// Exit code 1 if any starter has a problem. --index writes <repo-dir>/index.json.
"use strict";
const fs = require("fs");
const path = require("path");

const LEVELS = ["beginner", "intermediate", "advanced"], SIZES = ["small", "medium"];
const HEADINGS = ["## What you'll learn", "## Difficulty", "## Run it", "## Test it"];

function validate(dir, core) {
  const C = core || require(path.join(__dirname, "..", "app", "js", "core.js"));
  const root = path.join(dir, "starters");
  const problems = [], starters = [];
  if (!fs.existsSync(root)) return { problems: [`${dir}: no starters/ folder`], starters };
  const ids = new Set();
  for (const name of fs.readdirSync(root).sort()) {
    const folder = path.join(root, name);
    if (!fs.statSync(folder).isDirectory()) continue;
    const bad = msg => problems.push(`starters/${name}: ${msg}`);
    const read = f => { try { return fs.readFileSync(path.join(folder, f), "utf8"); } catch { bad(`missing ${f}`); return null; } };

    // starter.json
    const raw = read("starter.json");
    let meta = null;
    if (raw != null) { try { meta = JSON.parse(raw); } catch (e) { bad(`starter.json is not valid JSON (${e.message})`); } }
    if (meta) {
      if (meta.id !== name) bad(`id "${meta.id}" must match the folder name`);
      if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(meta.id || "")) bad("id: use lowercase letters, digits and -");
      if (ids.has(meta.id)) bad(`duplicate id "${meta.id}"`); ids.add(meta.id);
      if (!meta.title || meta.title.length > 40) bad("title: 1 to 40 characters");
      if (!LEVELS.includes(meta.level)) bad(`level: one of ${LEVELS.join(", ")}`);
      if (!SIZES.includes(meta.size)) bad(`size: one of ${SIZES.join(", ")}`);
      if (!meta.lang) bad("lang is required");
      if (!meta.idea || meta.idea.length < 20 || meta.idea.length > 400) bad("idea: 20 to 400 characters");
      if (!Array.isArray(meta.learn) || !meta.learn.length || meta.learn.length > 6 || meta.learn.some(x => typeof x !== "string" || !x.trim())) bad("learn: 1 to 6 short strings");
      if (/api[_ -]?key|sign up|account|paid/i.test(meta.idea || "")) bad("idea: starters must work offline (no keys, accounts or paid services)");
    }

    // project.txt
    const text = read("project.txt");
    if (text != null) {
      let m = null;
      try { m = C.parse(text); } catch (e) { bad(`project.txt doesn't parse: ${e.message}`); }
      if (m) {
        const files = C.finalFiles(m);
        if (![...files.keys()].some(p => C.classify(p) === "tests")) bad("project.txt needs at least one test file");
        if (!files.has("README.md")) bad("project.txt needs a README.md");
        if (m.commits.length < 2 || m.commits.length > 8) bad(`project.txt has ${m.commits.length} commits; use 2 to 8`);
        C.scanSecrets(m).forEach(h => bad(`possible ${h.name} in ${h.path}, line ${h.line}`));
        if (meta && m.project !== meta.id) bad(`project.txt PROJECT name "${m.project}" should be "${meta.id}"`);
      }
    }

    // README.md
    const readme = read("README.md");
    if (readme != null) HEADINGS.forEach(h => { if (!readme.includes(h)) bad(`README.md needs a "${h}" section`); });

    if (meta) starters.push({
      id: meta.id, title: meta.title, level: meta.level, lang: meta.lang, size: meta.size, idea: meta.idea, learn: meta.learn,
      ...(meta.time ? { time: meta.time } : {}), ...(meta.tags ? { tags: meta.tags } : {}),
      project: `starters/${name}/project.txt`, readme: `starters/${name}/README.md`,
    });
  }
  if (!starters.length && !problems.length) problems.push("no starters found");
  return { problems, starters };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const dir = args.find(a => !a.startsWith("--")) || ".";
  const ci = args.indexOf("--core");
  const core = ci >= 0 ? require(path.resolve(args[ci + 1])) : undefined;
  const { problems, starters } = validate(path.resolve(dir), core);
  problems.forEach(p => console.error("✗ " + p));
  if (problems.length) { console.error(`\n${problems.length} problem(s) in ${starters.length} starter(s).`); process.exit(1); }
  console.log(`✓ ${starters.length} starter(s) valid.`);
  if (args.includes("--index")) {
    const out = { version: 1, generated: new Date().toISOString().slice(0, 10), starters };
    fs.writeFileSync(path.join(dir, "index.json"), JSON.stringify(out, null, 2) + "\n");
    console.log("Wrote index.json");
  }
}

module.exports = { validate };
