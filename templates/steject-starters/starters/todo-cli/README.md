# To-do list in the terminal

Build a command-line to-do app that remembers your tasks between runs.

## What you'll learn

- Keeping the logic (`todo.py`) separate from input and output (`cli.py`), so it's easy to test
- Reading and writing JSON files
- Subcommands with `argparse` (`add`, `list`, `done`, `delete`)
- Testing with pytest, including `tmp_path` so tests never touch your real tasks

## Difficulty

Beginner. About 1 to 2 hours. You should know functions, lists and dictionaries.

## Run it

    python cli.py add "Buy milk"
    python cli.py list

## Test it

    pip install -r requirements.txt
    python -m pytest

## Make it yours

- Add due dates and sort by them.
- Add `python cli.py clear` to remove finished tasks.
- Color finished tasks green.
