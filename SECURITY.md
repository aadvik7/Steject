# Security policy

STEJECT handles GitHub tokens and AI keys and runs AI-written code, so security reports are very welcome.

## Report a problem privately

Use GitHub's **private vulnerability reporting**: open the repository's **Security** tab → **Report a vulnerability**. Please don't open a public issue for security problems.

Include what you found, the steps to reproduce it, and the version (Settings → App shows it). We aim to reply within 7 days.

## What's in scope

- Token or key leaks: anything that sends a GitHub token, AI key or Telegram token somewhere it shouldn't go, or stores it unencrypted in the desktop app.
- Escapes from the sandboxes: the project preview (`app/preview.html`), the Python worker (`app/js/pyworker.js`), or the local check runner in the desktop app (`electron/checks.js`, which must always ask before running a command).
- The network policy: the page reaching hosts not listed in the README's privacy section.
- The pre-push safety checks: a way to push a secret the scan should have blocked.
- Force pushes or history rewrites the user didn't confirm.

## Out of scope

- The AI giving wrong or low-quality answers.
- Problems in GitHub, Groq, Ollama or other services themselves.
- Attacks that need someone who already controls your computer.

## Supported versions

Only the latest release gets fixes. The desktop app shows an update bar when a newer version is out.
