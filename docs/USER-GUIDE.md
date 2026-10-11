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

Needs an AI helper (Settings → AI helper). Open **Start from an idea** on the Ship page, describe what you want in a sentence or two, choose **Small** (3 to 6 files) or **Medium** (5 to 9 files), and click **Write the project**. After about half a minute the project appears in Inspect. **Read the code before you push**: the AI can make mistakes. **Undo** brings back what was there before.

Tips: name the language, say what it should do, and ask for tests. Small projects work best on the free cloud AI.

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

To delete a file, the manifest needs `=== DELETE: path/to/file ===` before a `COMMIT` line.

## 4. If a push fails

Nothing on GitHub changes until the very last step, so a failed push never leaves a half-updated branch. Click **Resume push** to continue from the commit that failed.

## 5. Learn mode

Needs an AI helper. Open **Learn**:
- **Explain this file:** what it does, how it works, key concepts, and likely interview questions with answers.
- **Quiz me:** 5 multiple-choice questions about *your* code, with explanations.
- **Resume bullets:** 3 lines you can paste into your resume.

## 6. Settings

| Setting | What it's for |
|---|---|
| GitHub token | Needed to push. Use a classic token with the `repo` scope. |
| Telegram | A message after every push. Uncheck *Alert after every push* to pause it. |
| AI helper | Choose **Free cloud (Groq)** (paste a free key from console.groq.com/keys; your text is sent to Groq) or **Ollama** (runs on your computer; `qwen2.5-coder:3b` suits laptops with 8 GB RAM, `7b` gives better answers with 16 GB). |
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

## Keyboard shortcuts

| Keys | Action |
|---|---|
| Ctrl/Cmd + Enter | Push (or download the ship kit) |
| Ctrl/Cmd + O | Open a manifest file |
| Ctrl/Cmd + 1–4 | Ship, Learn, History, Settings |
