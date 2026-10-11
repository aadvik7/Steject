# Contributing to STEJECT

Thanks for helping. STEJECT is for students, so the bar for every change is: does it make shipping and understanding a project easier, and does it stay **free, serverless and private by default**?

## Ground rules

- **No server, no accounts.** Everything runs in the browser or the desktop app. Don't add a backend, telemetry, analytics or a login.
- **Private by default.** Code only leaves the computer when the user asks (push to GitHub, send to the AI they chose). New network hosts need a reason in the PR and an entry in the README privacy section and in `connect-src` in `app/index.html`.
- **Plain words.** UI text is for students. If you need a technical term, explain it in one line.
- **No build step.** The app is plain HTML, CSS and JavaScript in `app/`. Don't add a bundler or a framework.
- **Tests with every change.** New behavior needs a unit test (`test/core.test.js`) or a UI test (`test/e2e.mock.js`).

## Run it

```bash
npm install
npx playwright install chromium   # once, for the UI tests
npm test                          # unit tests
npm run test:e2e                  # UI tests with mocked GitHub, AI and Python
npm start                         # the desktop app
```

The web version is just `app/` served by any static server, for example `python -m http.server -d app 8080`.

## Where things are

| Path | What |
|---|---|
| `app/js/core.js` | Pure logic, no DOM: manifest parser, converter, secret and safety scans, diff, plans, polish pack. Most unit tests live here. |
| `app/js/github.js` | GitHub API: create, push, update, resume, import, pull requests |
| `app/js/ai.js` | AI clients (Ollama, Groq, OpenAI-style, in-browser) and all prompts |
| `app/js/runner.js`, `pyworker.js`, `preview.html` | "Check it runs": Python in a worker, web pages in a sandbox |
| `app/js/app.js` | UI controller |
| `app/starters/starters.js` | The starter gallery |
| `electron/` | Desktop wrapper. `checks.js` runs local test commands (with approval). |

## Add a starter idea

Edit [`app/starters/starters.js`](app/starters/starters.js) and add one object:

```js
{ id: "weather-cli", level: "beginner", lang: "Python", size: "small", title: "Weather from a CSV",
  idea: "A Python command-line tool that reads a CSV of daily temperatures and prints the hottest, coldest and average day. Functions in a module with pytest tests." },
```

- `level`: `beginner`, `intermediate` or `advanced`; `size`: `small` or `medium`.
- The idea must work offline: no API keys, accounts or paid services.
- Title under 40 characters, idea under 400.

Bigger starters with a full reference project, tests and a "what you'll learn" page go in the separate **steject-starters** repo. See [docs/STARTERS-REPO.md](docs/STARTERS-REPO.md).

## Pull requests

1. One change per PR. Describe it in plain words: what changes for a student, and why.
2. Run `npm test` and `npm run test:e2e` before you push. CI runs them too, plus a desktop smoke test.
3. Screenshots help for any UI change (the UI tests save some in `test/shots/`).
4. Be kind in reviews. See the [Code of Conduct](CODE_OF_CONDUCT.md).

## Reporting security problems

Please don't open a public issue. See [SECURITY.md](SECURITY.md).
