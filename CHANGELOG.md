# Changelog

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
