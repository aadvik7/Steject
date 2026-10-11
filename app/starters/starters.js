/*
 * STEJECT starter gallery: project ideas students can start from in one click.
 *
 * Contributing: add one object to the list below and open a pull request.
 *   level: "beginner" | "intermediate" | "advanced"
 *   size:  "small" (3 to 6 files) | "medium" (5 to 9 files)
 *   idea:  what the AI should build, in plain words. Name the language, what it does,
 *          and ask for tests. No API keys or paid services: projects must run offline.
 * Keep titles short (under 40 characters) and ideas under 400 characters.
 */
self.STE_STARTERS = [
  // ---------------------------------------------------------------- beginner
  { id: "todo-cli", level: "beginner", lang: "Python", size: "small", title: "To-do list in the terminal",
    idea: "A Python command-line to-do app: add, list, complete and delete tasks, saved to a JSON file. Use argparse, and add pytest tests for the task functions." },
  { id: "guess-number", level: "beginner", lang: "Python", size: "small", title: "Number guessing game",
    idea: "A Python number guessing game: the computer picks 1 to 100, the player guesses, the game says higher or lower and counts tries. Keep the logic in functions with pytest tests." },
  { id: "unit-converter", level: "beginner", lang: "Python", size: "small", title: "Unit converter",
    idea: "A Python command-line unit converter for length, weight and temperature with a simple menu. Put conversions in a module with pytest tests for each one." },
  { id: "tip-calculator", level: "beginner", lang: "HTML/CSS/JS", size: "small", title: "Tip calculator web page",
    idea: "A single-page tip calculator in plain HTML, CSS and JavaScript: bill amount, tip percent buttons and number of people, showing tip and total per person. Clean, mobile-friendly design, no frameworks." },
  { id: "quiz-page", level: "beginner", lang: "HTML/CSS/JS", size: "small", title: "Quiz web app",
    idea: "A multiple-choice quiz web page in plain HTML, CSS and JavaScript with 10 questions stored in a JS array, a progress bar, and a score screen at the end. No frameworks." },
  { id: "password-checker", level: "beginner", lang: "Python", size: "small", title: "Password strength checker",
    idea: "A Python tool that rates password strength (length, character types, common passwords list) and explains how to improve it. Logic in a module with pytest tests." },

  // ---------------------------------------------------------------- intermediate
  { id: "expense-tracker", level: "intermediate", lang: "Python", size: "medium", title: "Expense tracker with reports",
    idea: "A Python command-line expense tracker using SQLite (sqlite3): add expenses with category and date, list them, and print monthly totals per category. Separate database, logic and CLI modules, with pytest tests using a temporary database." },
  { id: "markdown-notes", level: "intermediate", lang: "HTML/CSS/JS", size: "medium", title: "Notes app with search",
    idea: "A notes web app in plain HTML, CSS and JavaScript: create, edit and delete notes, search by text, tags, and save everything in localStorage. Responsive layout, no frameworks." },
  { id: "text-adventure", level: "intermediate", lang: "Python", size: "medium", title: "Text adventure engine",
    idea: "A small Python text adventure engine where rooms, items and exits are defined in a JSON file. Commands: go, look, take, inventory. Separate parser and game-state modules with pytest tests." },
  { id: "library-system", level: "intermediate", lang: "Python", size: "medium", title: "Library management (OOP)",
    idea: "A Python library management system using classes for Book, Member and Library: borrow and return books, due dates and late fees, saved to JSON. Command-line menu and pytest tests." },
  { id: "kanban-board", level: "intermediate", lang: "HTML/CSS/JS", size: "medium", title: "Kanban board",
    idea: "A Kanban board web app in plain HTML, CSS and JavaScript with To do, Doing and Done columns, drag and drop between columns, and localStorage saving. No frameworks." },
  { id: "log-analyzer", level: "intermediate", lang: "Python", size: "medium", title: "Log file analyzer",
    idea: "A Python command-line tool that reads web server log lines (common log format), counts requests per status code and top 5 paths, and prints a report. Include a sample log file and pytest tests." },

  // ---------------------------------------------------------------- advanced
  { id: "rest-api", level: "advanced", lang: "Python", size: "medium", title: "Small REST API (standard library)",
    idea: "A REST API for a book list using only Python's standard library (http.server and sqlite3): GET, POST, PUT and DELETE /books with JSON. Keep request handling and storage in separate modules, with pytest tests for the storage layer and the routing logic." },
  { id: "tiny-interpreter", level: "advanced", lang: "Python", size: "medium", title: "Calculator language interpreter",
    idea: "A Python interpreter for a small calculator language with variables, + - * / and parentheses: a tokenizer, a recursive-descent parser that builds an AST, and an evaluator, plus a REPL. Thorough pytest tests for each stage." },
  { id: "pathfinding", level: "advanced", lang: "HTML/CSS/JS", size: "medium", title: "Pathfinding visualizer",
    idea: "A web app in plain HTML, CSS and JavaScript that visualizes BFS and A* on a grid: click to draw walls, set start and end, and watch the search animate. Algorithms in their own JS file. No frameworks." },
  { id: "bank-sim", level: "advanced", lang: "Python", size: "medium", title: "Bank system with transactions",
    idea: "A Python bank account system with accounts, deposits, withdrawals and transfers that are all-or-nothing, an audit log, and custom exceptions for errors like insufficient funds. Command-line interface and pytest tests for every rule." },
  { id: "spreadsheet", level: "advanced", lang: "HTML/CSS/JS", size: "medium", title: "Mini spreadsheet",
    idea: "A mini spreadsheet web app in plain HTML, CSS and JavaScript: a 10x10 grid, cells that hold numbers or formulas like =A1+B2 and =SUM(A1:A5), automatic recalculation, and a clear error for circular references. No frameworks." },
  { id: "cache-lru", level: "advanced", lang: "Python", size: "small", title: "LRU cache from scratch",
    idea: "An LRU cache in Python built from a hash map and a doubly linked list (no OrderedDict), with get, put, capacity and hit/miss stats, plus a decorator that caches function results. Detailed pytest tests including eviction order." },
];
