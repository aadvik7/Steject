# Changelog

## 1.3.0 — 2026-10-12

Still free, serverless and private by default.

- **Ship it for me:** one button from idea to pushed repo: plan (you approve it), write, check, AI fixes, safety checks, push. You set the limits first (AI calls, tokens, files, fix tries); private repo by default; it never pushes a possible secret and stops for you on warnings. Live step list, Stop button, summary at the end.
- **AI with no key and no install:** a small model runs in the browser on your graphics card (WebGPU, via WebLLM). STEJECT checks your device first, shows the download size before anything downloads, keeps the model in the browser cache, and warns that it's weaker than Groq or Ollama.
- **Real checks on the desktop:** Node.js, Go, Java and C/C++ projects (and Python packages the browser can't run) are checked with your own installed tools, always after you approve the exact commands, in a temporary folder that's deleted afterwards, without your tokens, with time and output limits and no network for package managers.
- **Issue → pull request:** paste an issue link; STEJECT explains the code in plain words, proposes a plan you approve, writes and checks the change, asks you three questions about it, and opens a pull request (from your fork if needed) with a plain-words description.
- **Classroom with PROOF.md:** teachers create assignment files (brief, requirements, starter files, visible or hidden checks, rubric); students get a PROOF.md in their repo (commits, check results, understanding score, SHA-256 fingerprint); the Review screen verifies a whole class against the real commits and re-runs the checks.
- **Checkpoints and undo:** every AI change saves a checkpoint you can restore in one click; the last push to a repo can be undone with a revert commit or a confirmed reset.
- **Repo doctor:** a score and plain-words checklist for any repo (README, license, .gitignore and committed junk, tests, CI, big files, secrets, old dependencies, structure), and *Fix it* turns the gaps into a pull request.
- **Safety checks before push:** secrets in files and commit messages always block; typo-named packages, deprecated or hijacked packages, install scripts, unpinned or URL dependencies and GPL code in a permissive project are warnings you confirm.
- **Network policy tightened** to an explicit host list again; AI addresses you add go through a small worker that only calls https (or this computer). Clear message when Python for the browser can't be downloaded.
- **Community:** CONTRIBUTING, Code of Conduct, SECURITY, ROADMAP, issue and PR templates, and the spec, template and validator for the `steject-starters` repo. The gallery can load community starters and open a finished example.
- New **Tools** page and an in-app **Help** panel (Settings).

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
