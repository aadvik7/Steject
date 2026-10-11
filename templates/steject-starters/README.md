# steject-starters

Starter projects for [STEJECT](https://github.com/aadvik7/Steject): each one is an idea, a finished reference project with tests, and a page that says what you'll learn.

STEJECT's starter gallery reads [`index.json`](index.json), so a starter merged here shows up in the app without an app update.

## Add a starter

1. Copy `starters/todo-cli/` to `starters/<your-id>/`.
2. Edit `starter.json` (title, level, language, size, idea, what you'll learn).
3. Put the full project in `project.txt` in STEJECT's manifest format. It needs a `README.md` and at least one test file. Tip: build it in STEJECT, then copy the text from the Paste box.
4. Write `README.md` with the sections *What you'll learn*, *Difficulty*, *Run it* and *Test it*.
5. Check it, then open a pull request:

```bash
curl -sO https://raw.githubusercontent.com/aadvik7/Steject/main/app/js/core.js
curl -sO https://raw.githubusercontent.com/aadvik7/Steject/main/scripts/validate-starters.js
node validate-starters.js . --core core.js --index
```

The full rules are in the [spec](https://github.com/aadvik7/Steject/blob/main/docs/STARTERS-REPO.md).

## Rules

- Projects must run offline: no API keys, accounts or paid services.
- Keep them small enough for a student to read in one sitting.
- Be kind in reviews ([Code of Conduct](https://github.com/aadvik7/Steject/blob/main/CODE_OF_CONDUCT.md)).
