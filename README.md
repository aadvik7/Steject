<p align="center"><img src="app/icons/icon-192.png" width="96" alt=""></p>

<h1 align="center">STEJECT</h1>

<p align="center"><b>Turn a project written by ChatGPT or Claude into a real GitHub repo with real commits.</b><br>
Desktop app for Windows, Mac and Linux. Free, open source, and private: your code goes only to GitHub.</p>

<p align="center">
  <a href="../../releases/latest"><b>⬇ Download the app</b></a> ·
  <a href="docs/USER-GUIDE.md">User guide</a> ·
  <a href="PROMPT_TEMPLATE.md">Prompts</a>
</p>

![STEJECT ship screen](docs/screenshots/ship.png)

## Why

Chat AIs can write a whole project in one reply. Getting it onto GitHub still means creating folders, copying files one by one, writing commit messages and pushing. STEJECT does that part for you, and then helps you actually understand the code you're about to put on your resume.

## What it does

- **Paste and check:** paste the AI's reply. STEJECT checks the format and every file path, and scans for leaked API keys before anything leaves your computer.
- **Works with normal replies too:** if the AI ignored the format, STEJECT finds each file name and its code block and builds the commit plan itself. No AI needed.
- **Inspect:** read every file and the full commit plan first.
- **One-click push:** creates the repo and pushes real commits through the GitHub API. No Git install, no terminal.
- **Update mode:** paste changes for an existing repo. STEJECT shows what's new, changed or deleted compared with GitHub, then adds commits on top. It never overwrites history.
- **Resume:** if your internet drops mid-push, continue from where it stopped.
- **Telegram alerts:** get a message when a push succeeds or fails.
- **Local AI (Ollama):** free and private, running on your computer:
  - fixes broken manifests
  - writes a README
  - re-plans commits
- **Learn mode:** explains every file the way an interviewer would ask about it, quizzes you on your own code, and writes resume bullets.
- **History:** every project you've shipped, with links.
- **Ship kit:** no token? Download a script that builds the repo with Git on your computer.

| Update mode with changes view | Learn mode quiz |
|---|---|
| ![Update](docs/screenshots/update-diff.png) | ![Learn](docs/screenshots/learn.png) |

## Install

Download the file for your computer from the [latest release](../../releases/latest):

| Computer | File |
|---|---|
| Windows | `STEJECT-x.y.z-win-x64.exe` (installer) or `STEJECT-x.y.z-portable.exe` |
| Mac with Apple chip | `STEJECT-x.y.z-mac-arm64.dmg` |
| Mac with Intel chip | `STEJECT-x.y.z-mac-x64.dmg` |
| Linux | `.AppImage` or `.deb` |

The app isn't code-signed yet, so the first launch shows a warning:
- **Windows:** *More info* → *Run anyway*
- **Mac:** right-click the app → *Open* → *Open* (or run `xattr -cr /Applications/STEJECT.app`)
- **Linux:** `chmod +x STEJECT-*.AppImage`, then run it

Prefer the browser? The web version runs on this repo's GitHub Pages site and can be installed as an app from Chrome or Edge.

## First run (5 minutes)

1. **GitHub:** Settings → paste a [classic token with the `repo` scope](https://github.com/settings/tokens/new?scopes=repo&description=STEJECT) → Connect.
2. **Telegram (optional):** create a bot with @BotFather, paste its token, click *Find my chat ID*, then *Send test message*.
3. **Local AI (optional):** install [Ollama](https://ollama.com/download), then click *Download* next to `qwen2.5-coder:3b` in Settings.

Then copy the prompt from the Ship page into ChatGPT or Claude, paste the reply, and click Push.

## The manifest format

```
=== PROJECT: hello-app ===
=== FILE: app.py ===
print("hello")
=== COMMIT: Add main script ===
=== FILE: README.md ===
# hello-app
=== DELETE: old.py ===
=== COMMIT: Add README, remove old script ===
```

Files and deletes belong to the next `COMMIT` line. Full prompts: [PROMPT_TEMPLATE.md](PROMPT_TEMPLATE.md).

## Privacy and safety

- Tokens are encrypted with your operating system's keychain (desktop app) and stored only on your computer.
- Network access is limited to `api.github.com`, `api.telegram.org` and your local Ollama. Anything else is blocked by the app's security policy.
- Pushing stops if a possible secret is found: GitHub, AWS, OpenAI-style, Google, Slack or Stripe keys, private keys, or hardcoded passwords.
- STEJECT never force-pushes over existing history. Replacing GitHub's single "Initial commit" requires your confirmation.

## Development

```bash
npm install
npm start              # run the desktop app
npm test               # unit tests
npm run test:e2e       # UI tests against mocked GitHub, Telegram and Ollama
npm run test:desktop   # desktop app smoke test (use xvfb-run on Linux servers)
npm run dist           # build installers for your OS into dist/
```

The app is plain HTML, CSS and JavaScript in `app/` with no build step. `electron/` wraps it as a desktop app. Releases are built by GitHub Actions (`.github/workflows/release.yml`) whenever a `v*` tag is pushed.

```
app/            the app (also served as the web version)
  js/core.js    manifest parser, chat-reply converter, secret scan, diff
  js/github.js  GitHub API: create repo, push, update, resume
  js/ai.js      Ollama and Telegram clients, AI prompts
  js/app.js     UI controller
electron/       desktop wrapper (main process + preload bridge)
test/           unit, UI and desktop tests
```

## Roadmap

- [ ] Image and binary files in projects
- [ ] Sign installers so there's no first-run warning
- [ ] Run the project's tests before pushing (desktop app)
- [ ] More AI providers (LM Studio, OpenAI-compatible servers)

## License

[MIT](LICENSE). Fonts are under the SIL Open Font License. JSZip, marked and DOMPurify licenses are in `app/vendor/`.
