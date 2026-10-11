# Changelog

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
