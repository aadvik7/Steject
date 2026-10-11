# Changelog

## 1.2.0 — 2026-10-12

A small, student-friendly Claude Code: describe a project, review the plan, get working code, change it by chatting, and prove you understand it.

- **Plan, approve, write:** an idea first becomes an editable file tree and commit plan. Rename, add or remove files and commits, then approve. Only then are files written, grouped exactly as planned.
- **Change it with AI:** type a change ("add a delete command"). The AI returns only the changed files as a new commit, with a diff and *changed* badges in Inspect.
- **Self-check loop:** *Check it runs* runs Python tests (pytest) or the main script in the browser, or opens web pages in a sandbox. If it fails, the error goes back to the AI to fix, up to 3 tries. Node, Java and Go say honestly that they can't be checked yet.
- **Live preview:** web projects show in a sandboxed *Preview* tab with no network access, and the page's console underneath.
- **Understanding gate and mock interview:** optionally require passing the quiz (3 of 5) or a 5-question mock interview (6 of 10) before pushing a version, and add the score to the README.
- **Open an existing project:** open a local folder, or a GitHub repo by name. Your own repo opens in Update mode, so changes go on top as new commits. Build folders, binaries and very large files are left out.
- **Starter gallery:** 18 project ideas by level (beginner to advanced) that fill the idea box in one click. They live in `app/starters/starters.js`, so anyone can contribute one.
- **Pull request mode:** in Update mode, push to a new branch and open a pull request instead of writing to main.
- **Repo polish pack:** add a LICENSE, a language-specific .gitignore, issue templates, a CI workflow, and AGENTS.md + CLAUDE.md for AI coding tools, as one reviewable commit.
- **Any AI provider:** any OpenAI-style address (OpenRouter, Google Gemini, LM Studio, a college server), with presets, a model list, and a usage counter with an optional daily limit.
- Clear message when a token can't push CI files (it needs the `workflow` scope); the token link now asks for it.
- Ship page: Paste and Inspect are now the same height, and Push runs full width underneath with its fields lined up in two columns. The code viewer fills its box.
- Secret scan also catches Groq, Hugging Face and npm tokens.
- Groq: if a model can't produce strict JSON (quiz, commit plan), STEJECT retries once without JSON mode instead of failing.
- Web version: the offline cache is named after each build, so a new deploy is picked up without a manual version bump.
- Maintenance: newer GitHub Actions (fewer deprecation warnings), consistent LF line endings, test screenshots kept out of the repo.

## 1.1.0 — 2026-10-11

- **Start from an idea:** describe a project in a sentence and the AI writes it as a manifest (3 to 9 files, 3 to 5 commits). The result goes straight into Inspect so you can read it before pushing. If the AI breaks the format, STEJECT sends the problem back and retries up to twice.
- **Free cloud AI (Groq):** add a free Groq API key in Settings and get the AI helper without installing anything. It works for idea-to-project, Fix, README, re-plan commits and the whole Learn page. Ollama still works and stays the private option.
- Handles Groq's free limits: waits a few seconds when the per-minute limit is hit, and explains the daily limit in plain words.
- Clearer message when you paste code without file names (copied from a single code block or from the page).
- Settings now says plainly that Groq receives the text you use AI on.

## 1.0.0 — 2026-10-07

First release.

- Desktop app for Windows, Mac and Linux, plus an installable web version
- Manifest parser with path safety checks, `DELETE` support and a secret scan
- Converts normal chat replies (file names + code blocks) into manifests without AI
- One-click push to a new GitHub repo through the GitHub API
- Update mode: compares with GitHub (new / changed / same / delete, line diffs) and adds commits on top with a fast-forward
- Resume after a failed push
- Telegram alerts with chat ID finder and test message
- Local AI through Ollama: model download, manifest repair, README writer, commit re-planning
- Learn mode: file explanations, quiz, resume bullets
- History of shipped projects
- Offline ship kit (`ship.sh`) for pushing with local Git
- Encrypted token storage, strict content security policy, light and dark themes
