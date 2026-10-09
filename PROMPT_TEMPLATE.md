# STEJECT prompts

Copy one of these into ChatGPT, Claude or any chat AI. Both are also inside the app (Ship → Get the prompt).

## New project

```text
Build me a complete project, and output it ONLY in the STEJECT manifest format below. No explanations outside the manifest.

FORMAT RULES (strict):
1. First line: === PROJECT: <folder-name> ===  (letters, numbers, - _ . only)
2. Every file starts with a line === FILE: <relative/path> === followed by the full file contents. Never write "..." or "rest of the code here". Write every file completely.
3. After the files that belong together, add a line === COMMIT: <short commit message> ===. Split the project into 4 to 8 logical commits (setup, core logic, tests, docs). Every file must come before the COMMIT line it belongs to.
4. To remove a file in an update, write === DELETE: <path> === before the COMMIT line.
5. Include a README.md with: what it does, how to install, how to run, and a short "how it works" section.
6. Include at least one test file if the language supports it.
7. Never include real API keys, passwords or tokens. Use environment variables and a .env.example.
8. Use relative paths only. No absolute paths, no "..".
9. Put the whole manifest in ONE code block.

EXAMPLE:
=== PROJECT: hello-app ===
=== FILE: app.py ===
print("hello")
=== COMMIT: Add main script ===
=== FILE: README.md ===
# hello-app
Prints hello.
=== COMMIT: Add README ===

MY PROJECT:
<describe what you want built here>
```

## Change an existing project

Paste your current files after this prompt (or attach them), then describe the change.

```text
Here is my current project. Make the change I describe below and output ONLY the files you add or change, in the STEJECT manifest format (=== FILE: path === blocks followed by === COMMIT: message === lines; use === DELETE: path === to remove a file). Write every changed file completely. Keep the same === PROJECT: name === line.

CHANGE I WANT:
<describe the change here>
```
