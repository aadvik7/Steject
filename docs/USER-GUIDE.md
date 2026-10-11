# STEJECT user guide

## 1. Ship a new project

1. On the **Ship** page, open *Get the prompt for ChatGPT or Claude* and click **Copy prompt**.
2. Paste it into ChatGPT or Claude, replace the last line with your project idea, and send it.
3. Copy the whole reply and paste it into STEJECT. You can also save it as a `.txt` file and drag it in, or press **Ctrl+O**.
4. Check the **Inspect** panel:
   - **Format, Paths, Secret scan** should all be green.
   - Click any file in the commit plan to read it.
5. Under **Push**, keep *New repo*, check the repo name, and choose Public or Private.
6. Click **Push** (or press **Ctrl+Enter**). The log shows every step and ends with a link to your repo.

## Start from an idea (no chat AI needed)

Needs an AI helper (Settings → AI helper).

1. Open **Start from an idea** on the Ship page. Pick a **starter** (filter by Beginner, Intermediate or Advanced) or describe your own idea in a sentence or two.
2. Choose **Small** (3 to 6 files) or **Medium** (5 to 9 files) and click **Plan the project**.
3. The AI proposes a **plan**: project name, commits and files, each with a one-line purpose. Nothing is written yet. Rename commits, change paths, add or remove files (**+ File**, **×**) and commits (**+ Commit**).
4. Click **Approve and write the files**. The AI writes exactly that plan, and the commits follow it.
5. With *Then check it runs* ticked, STEJECT checks it right away and lets the AI fix failures, up to 3 tries.

**Read the code before you push**: the AI can make mistakes. **Undo** brings back what was there before.

Tips: name the language, say what it should do, and ask for tests. Small projects work best on the free cloud AI.

## Check it runs, and preview it

In Inspect, click **▶ Check it runs**:
- **Python:** runs your tests with pytest, or compiles the files and runs the main script (`main.py`, `app.py`, …). A program that asks for keyboard input is stopped there, and one that keeps running (a server or a loop) is stopped after 15 seconds. Both count as running. The first check downloads Python for the browser (about 10 MB, once).
- **Web pages:** opens `index.html` in a sandbox and collects errors from the page's console.
- **Node, Java, Go:** can't be checked inside STEJECT yet. It tells you the command to run on your computer instead.

If it fails, click **Fix with AI**: the error output goes to the AI, which returns only the fixed files. STEJECT checks again, up to 3 tries. Fixes go into the existing commits, are marked *changed*, and **Undo** reverts all of them.

Web projects also get a **Preview** tab next to File and Changes. It's sandboxed: the page has no network access and can't see STEJECT or your tokens.

## Change a project by chatting

With a valid project and an AI helper, type a change under **Change it with AI**, like *add a command to delete a task*, and press Enter. The AI returns only the files that change, added as a new commit. Changed files get a badge, and the **Changes** tab shows the exact lines. Push them as new commits, or click **Undo**.

## Open an existing project

- **Open folder:** pick a project folder on your computer.
- **From GitHub:** type `owner/name` (or pick one of yours) and click **Open it**. Your own repos open in **Update a repo** mode, so anything you change is pushed on top as new commits.

STEJECT reads text files only, and leaves out folders like `node_modules`, `.git`, `dist` and virtual environments, plus images, binaries and files over 200 KB (up to 300 files). Then use Learn to understand it, *Check it runs*, or *Change it with AI*.

## Repo polish pack

Open **Polish the repo**, tick what you want and click **Add them as a commit**:
- **LICENSE:** MIT, with your GitHub name and the year.
- **.gitignore:** picked for the project's language.
- **Issue templates:** bug report and feature request.
- **CI workflow:** runs the tests on GitHub on every push. Your token needs the `workflow` scope.
- **AGENTS.md + CLAUDE.md:** tells AI coding tools how to run, test and change the project.

Files the project (or the GitHub repo, in Update mode) already has are skipped.

## 2. When the AI ignores the format

- **Normal reply with code blocks:** STEJECT shows *This looks like a normal chat reply*. Click **Convert to manifest**. It finds each file name (like **app.py** above a code block) and groups files into commits. Install commands and example output are skipped.
- **Something messier:** click **Fix with AI** (needs an AI helper). Always check the files afterwards: small models can make mistakes.
- **Undo** puts back what you had before converting or fixing.

## 3. Change a project that's already on GitHub

1. Open *Get the prompt* → **Change a project**, copy it, and give it to the chat AI along with your current files and the change you want.
2. Paste the reply into STEJECT.
3. Under **Push**, choose **Update a repo** and pick the repo.
4. STEJECT compares the manifest with GitHub. Each file shows *new*, *changed*, *same* or *delete*, and the **Changes** tab shows the exact lines.
5. Click **Add N commits**. Your commits go on top of the existing history. Commits that change nothing are skipped.

**Pull request instead:** tick *Push to a new branch and open a pull request*. STEJECT suggests a branch name and title from the last commit; change them if you like. Your commits go to the new branch and a pull request into the default branch is opened, so main stays untouched until you merge it on GitHub.

To delete a file, the manifest needs `=== DELETE: path/to/file ===` before a `COMMIT` line.

## 4. If a push fails

Nothing on GitHub changes until the very last step, so a failed push never leaves a half-updated branch. Click **Resume push** to continue from the commit that failed.

## 5. Learn mode

Needs an AI helper. Open **Learn**:
- **Explain this file:** what it does, how it works, key concepts, and likely interview questions with answers.
- **Quiz me:** 5 multiple-choice questions about *your* code, with explanations.
- **Mock interview:** an interviewer asks 5 questions about this project, one at a time. Answer in your own words (Ctrl+Enter sends). Each answer gets feedback and 0 to 2 points.
- **Resume bullets:** 3 lines you can paste into your resume.

**Understanding gate:** tick it to require passing the quiz (3 of 5) or the mock interview (6 of 10) before you can push. It applies to *this version* of the project: after a change, pass again. Once you pass, the Push panel offers **Add my score to the README**, which adds an *Understanding check* section as a new commit.

## 6. Settings

| Setting | What it's for |
|---|---|
| GitHub token | Needed to push. Use a classic token with the `repo` scope. |
| Telegram | A message after every push. Uncheck *Alert after every push* to pause it. |
| AI helper | Choose **Free cloud (Groq)** (paste a free key from console.groq.com/keys; your text is sent to Groq), **Ollama** (runs on your computer; `qwen2.5-coder:3b` suits laptops with 8 GB RAM, `7b` gives better answers with 16 GB), or **Other (OpenAI-style)**: pick a preset (OpenRouter, Google Gemini, LM Studio) or type any https address, add its key, and pick a model. |
| Usage today | Requests and tokens used today with the current AI helper. Set a daily request limit to get a warning near it. |
| Theme | System, light or dark. |
| Remove all saved data | Deletes tokens, settings and history from this computer. |

## 7. Ship kit (no token)

Choose **Ship kit**, optionally paste an empty repo's URL, and download the zip. Unzip it and run `bash ship.sh` (on Windows, use Git Bash). It builds the repo with Git on your computer and pushes it.

## Troubleshooting

| Problem | Fix |
|---|---|
| "GitHub rejected the token" | The token is wrong, expired or revoked. Create a new one. |
| "Your token doesn't have permission" | Fine-grained tokens often lack repo creation. Use a classic token with `repo`. |
| "already has history" in New repo mode | Switch to **Update a repo**, or pick a new name. |
| "changed on GitHub while STEJECT was pushing" | Someone pushed at the same moment. Click Push again. |
| "Groq rejected the API key" | Copy the key again from console.groq.com/keys. It starts with `gsk_`. |
| "used today's free Groq limit" | The free plan has daily limits per model. Pick another model in Settings, switch to Ollama, or try tomorrow. |
| "Couldn't reach Groq" in a browser | Use the desktop app, which has no such limit. |
| Ollama not found | Install it from ollama.com, open it, then click **Check again** in Settings. |
| Web version can't reach Ollama | Quit Ollama, set `OLLAMA_ORIGINS=*`, start it again. The desktop app doesn't need this. |
| Telegram "chat not found" | Send your bot a message first, then click **Find my chat ID**. |
| "Your token can't add or change GitHub Actions files" | Pushing a CI workflow needs a classic token with the `repo` **and** `workflow` scopes. |
| "A branch called … already exists" | Pull request mode: pick another branch name. |
| *Check it runs* says "needs packages that can't run in the browser" | Some packages (with C code or network servers) don't work in Pyodide. Run the project on your computer instead. |
| A custom AI address doesn't connect in a browser | The service may block calls from web pages. Use the desktop app. |

## Keyboard shortcuts

| Keys | Action |
|---|---|
| Ctrl/Cmd + Enter | Push (or download the ship kit) |
| Ctrl/Cmd + O | Open a manifest file |
| Ctrl/Cmd + 1–4 | Ship, Learn, History, Settings |
