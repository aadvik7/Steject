/*
 * STEJECT safety checks before a push. Pure functions, no DOM, no network.
 * Findings are "block" (secrets: never pushed) or "warn" (the student must confirm).
 * Works in the browser (window.SteSafety) and in Node (require) for tests.
 */
(function (root, factory) {
  const api = factory(root.SteCore || (typeof require === "function" ? require("./core.js") : null));
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.SteSafety = api;
})(typeof self !== "undefined" ? self : this, function (C) {
  "use strict";

  // ------------------------------------------------------------------ bundled package lists (no network needed)
  const NPM_POPULAR = ("react react-dom preact express koa fastify hapi lodash underscore axios chalk commander debug moment dayjs date-fns luxon uuid nanoid " +
    "vue svelte next nuxt typescript webpack webpack-cli vite rollup esbuild parcel eslint prettier jest mocha chai sinon vitest karma nyc supertest " +
    "dotenv cors body-parser cookie-parser express-session compression helmet morgan multer passport jsonwebtoken bcrypt bcryptjs " +
    "mongoose mongodb mysql mysql2 pg sequelize knex prisma typeorm sqlite3 better-sqlite3 redis ioredis socket.io socket.io-client ws " +
    "nodemon yargs inquirer ora glob rimraf mkdirp fs-extra node-fetch cross-env concurrently tailwindcss postcss autoprefixer sass less " +
    "styled-components redux react-redux react-router react-router-dom jquery async bluebird rxjs zod joi yup ajv validator classnames clsx " +
    "prop-types formik swr graphql immer mobx zustand framer-motion three d3 chart.js electron ts-node tslib marked highlight.js cheerio jsdom " +
    "puppeteer playwright sharp jimp canvas nodemailer winston pino semver minimist qs superagent firebase stripe twilio openai discord.js " +
    "telegraf xml2js csv-parser papaparse xlsx pdfkit archiver tar chokidar open execa shelljs lru-cache node-cache bull node-cron " +
    "handlebars ejs pug nunjucks mustache http-errors serve-static path-to-regexp babel-loader css-loader style-loader html-webpack-plugin").split(" ");
  const PYPI_POPULAR = ("requests numpy pandas flask django fastapi uvicorn pytest scipy matplotlib seaborn scikit-learn tensorflow torch torchvision " +
    "keras pillow beautifulsoup4 lxml selenium sqlalchemy psycopg2 psycopg2-binary pymysql redis celery boto3 botocore pyyaml jinja2 click typer " +
    "rich tqdm pydantic httpx aiohttp urllib3 certifi idna charset-normalizer six python-dateutil pytz setuptools wheel pip black flake8 pylint " +
    "mypy isort coverage tox numba opencv-python nltk spacy transformers openai langchain streamlit gradio dash plotly bokeh networkx sympy " +
    "jupyter notebook ipython pygame pyqt5 kivy discord-py python-telegram-bot tweepy praw scrapy paramiko cryptography pycryptodome passlib " +
    "pyjwt python-dotenv gunicorn waitress marshmallow alembic peewee pymongo motor websockets pyserial colorama termcolor tabulate openpyxl " +
    "xlrd xlsxwriter reportlab pypdf2 pypdf pdfplumber markdown docutils sphinx attrs toml tomli regex joblib statsmodels xgboost lightgbm " +
    "catboost h5py pyarrow polars faker arrow pendulum schedule apscheduler watchdog psutil pexpect fire docopt loguru structlog sentry-sdk " +
    "prometheus-client flask-cors flask-sqlalchemy flask-login djangorestframework pytest-cov hypothesis").split(" ");
  const PY_STDLIB = ("json os sys re math random time datetime collections itertools functools typing pathlib subprocess threading asyncio " +
    "logging argparse csv sqlite3 unittest uuid hashlib base64 pickle shutil glob tkinter socket http urllib email statistics decimal " +
    "fractions string textwrap copy pprint enum dataclasses abc io tempfile zipfile tarfile configparser getpass secrets platform queue " +
    "heapq bisect array struct timeit traceback warnings contextlib operator").split(" ");
  const DEPRECATED = {
    npm: {
      "request": "deprecated since 2020; use the built-in fetch or axios",
      "request-promise": "deprecated with request; use fetch or axios",
      "node-sass": "deprecated; use sass",
      "tslint": "deprecated; use eslint",
      "babel-eslint": "deprecated; use @babel/eslint-parser",
      "left-pad": "unnecessary; use String.prototype.padStart",
      "gulp-util": "deprecated",
      "istanbul": "deprecated; use nyc or c8",
      "event-stream": "a version of it was hijacked to steal cryptocurrency (2018)",
      "flatmap-stream": "this package was malicious (event-stream incident)",
      "colors": "its author published versions that break programs (1.4.1+); pin 1.4.0 or use chalk",
      "faker": "its author deleted the code; use @faker-js/faker",
    },
    pypi: {
      "pycrypto": "unmaintained with known security holes; use pycryptodome",
      "sklearn": "a placeholder name; install scikit-learn",
      "bs4": "an alias; install beautifulsoup4",
      "pil": "Python 2 only; install pillow",
      "nose": "unmaintained; use pytest",
      "distribute": "obsolete; setuptools replaced it",
    },
  };

  // ------------------------------------------------------------------ helpers
  /** Edit distance with adjacent swaps (optimal string alignment), stopping early above `max`. */
  function distance(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    const d = [];
    for (let i = 0; i <= a.length; i++) { d[i] = [i]; }
    for (let j = 0; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
      let rowMin = Infinity;
      for (let j = 1; j <= b.length; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
        rowMin = Math.min(rowMin, d[i][j]);
      }
      if (rowMin > max) return max + 1;
    }
    return d[a.length][b.length];
  }
  const pyName = n => n.toLowerCase().replace(/[_.]+/g, "-");

  /** A popular package this name looks like (but isn't), or null. */
  function lookalike(name, list) {
    if (name.startsWith("@") || list.includes(name) || name.length < 4) return null;
    const max = name.length >= 9 ? 2 : 1;
    let best = null, bestD = max + 1;
    for (const p of list) {
      if (p.length < 4) continue;
      const d = distance(name, p, max);
      if (d > 0 && d < bestD) { best = p; bestD = d; }
    }
    return best;
  }

  /** npm dependencies from package.json: [{name, spec, section}] (or null if it isn't valid JSON). */
  function npmDeps(text) {
    let pkg;
    try { pkg = JSON.parse(text); } catch { return null; }
    const out = [];
    ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"].forEach(section => {
      Object.entries((pkg && pkg[section]) || {}).forEach(([name, spec]) => out.push({ name, spec: String(spec), section }));
    });
    return { deps: out, pkg };
  }
  /** Python requirements: [{name, spec, line}] */
  function pyDeps(text) {
    const out = [];
    String(text).split("\n").forEach((raw, i) => {
      const line = raw.split("#")[0].trim();
      if (!line || line.startsWith("-")) return;
      if (/^(git\+|hg\+|svn\+|https?:|file:)/i.test(line) || / @ (git\+|https?:)/i.test(line)) { out.push({ name: line, spec: line, line: i + 1, raw: line, url: true }); return; }
      const m = line.match(/^([A-Za-z0-9][A-Za-z0-9._-]*)(\[[^\]]*\])?\s*(.*)$/);
      if (m) out.push({ name: pyName(m[1]), spec: m[3].trim(), line: i + 1, raw: line });
    });
    return out;
  }

  // ------------------------------------------------------------------ licenses
  const PERMISSIVE = /\b(MIT|Apache[- ]?2(\.0)?|BSD|ISC|Unlicense|Zlib|0BSD)\b/i;
  function projectLicense(files) {
    const lic = files.get("LICENSE") || files.get("LICENSE.md") || files.get("LICENSE.txt") || files.get("COPYING");
    if (lic) {
      if (/GNU (AFFERO |LESSER )?GENERAL PUBLIC LICENSE/i.test(lic)) return "GPL";
      if (/\bMIT License\b|Permission is hereby granted, free of charge/i.test(lic)) return "MIT";
      if (/Apache License/i.test(lic)) return "Apache-2.0";
      if (/BSD/i.test(lic)) return "BSD";
      if (/ISC License/i.test(lic)) return "ISC";
    }
    for (const f of ["package.json"]) {
      try { const l = JSON.parse(files.get(f) || "null"); if (l && typeof l.license === "string") return l.license; } catch {}
    }
    const py = files.get("pyproject.toml") || "";
    const m = py.match(/license\s*=\s*(?:\{\s*text\s*=\s*)?["']([^"']+)["']/i);
    return m ? m[1] : null;
  }
  const GPL_MARK = /SPDX-License-Identifier:\s*(A|L)?GPL|GNU (Affero |Lesser )?General Public License|under the terms of the GNU/i;

  // ------------------------------------------------------------------ scan
  /**
   * All findings for a manifest. Each: {level: "block"|"warn", kind, path, line, message}.
   * kind: secret | typosquat | deprecated | stdlib | script | unpinned | source | license
   */
  function scan(m) {
    const out = [];
    const add = (level, kind, path, line, message) => out.push({ level, kind, path, line: line || null, message });

    // 1. secrets in files and in commit messages: always block
    C.scanSecrets(m).forEach(h => add("block", "secret", h.path, h.line, `Possible ${h.name}`));
    m.commits.forEach((c, i) => {
      for (const [name, re] of C.SECRETS) {
        if (re.test(c.message) && !C.isPlaceholderSecret(name, c.message)) { add("block", "secret", `commit ${i + 1} message`, null, `Possible ${name} in the commit message "${c.message.slice(0, 40)}…"`); break; }
      }
    });

    const files = C.finalFiles(m);
    // 2. npm dependencies
    const pj = files.has("package.json") ? npmDeps(files.get("package.json")) : null;
    if (pj) {
      pj.deps.forEach(d => {
        const dep = DEPRECATED.npm[d.name];
        if (dep) add("warn", "deprecated", "package.json", null, `"${d.name}": ${dep}.`);
        const look = lookalike(d.name, NPM_POPULAR);
        if (look) add("warn", "typosquat", "package.json", null, `"${d.name}" looks like the popular package "${look}". Typo-named packages are a common way to sneak in malware. Check the spelling.`);
        if (/^(\*|latest|x)$/i.test(d.spec.trim()) || d.spec.trim() === "") add("warn", "unpinned", "package.json", null, `"${d.name}" has no version ("${d.spec}"), so any future version could be installed. Use a range like ^1.2.3.`);
        if (/^(git|git\+|https?:|github:|file:)/i.test(d.spec) || /^[\w-]+\/[\w.-]+(#.*)?$/.test(d.spec)) add("warn", "source", "package.json", null, `"${d.name}" comes from ${d.spec}, not the npm registry. Make sure you trust that source.`);
      });
      const scripts = (pj.pkg && pj.pkg.scripts) || {};
      ["preinstall", "install", "postinstall", "prepare"].forEach(k => {
        if (!scripts[k]) return;
        const risky = /curl|wget|powershell|Invoke-WebRequest|bash\s+-c|sh\s+-c|node\s+-e|eval|base64|https?:\/\//i.test(scripts[k]);
        add("warn", "script", "package.json", null, `"${k}" script runs automatically on npm install: ${scripts[k].slice(0, 80)}${risky ? ". It downloads or runs code, which is how many malicious packages work." : ". Make sure it's needed."}`);
      });
    }
    // 3. Python requirements
    if (files.has("requirements.txt")) {
      pyDeps(files.get("requirements.txt")).forEach(d => {
        if (d.url) { add("warn", "source", "requirements.txt", d.line, `"${d.raw}" installs from a URL, not PyPI. Make sure you trust that source.`); return; }
        if (PY_STDLIB.includes(d.name)) { add("warn", "stdlib", "requirements.txt", d.line, `"${d.name}" is part of Python's standard library. Remove it: a package with that name on PyPI is not the real module.`); return; }
        const dep = DEPRECATED.pypi[d.name];
        if (dep) add("warn", "deprecated", "requirements.txt", d.line, `"${d.name}": ${dep}.`);
        const look = !dep && lookalike(d.name, PYPI_POPULAR);
        if (look) add("warn", "typosquat", "requirements.txt", d.line, `"${d.name}" looks like the popular package "${look}". Typo-named packages are a common way to sneak in malware. Check the spelling.`);
      });
    }
    // 4. license conflicts (only when headers say so)
    const lic = projectLicense(files);
    if (lic && PERMISSIVE.test(lic) && !/GPL/i.test(lic)) {
      files.forEach((text, path) => {
        if (/(^|\/)(LICENSE|COPYING|LICENSES?\/)/i.test(path) || !text) return;
        const head = text.split("\n").slice(0, 40).join("\n");
        if (GPL_MARK.test(head)) add("warn", "license", path, null, `This file says it's GPL-licensed, but the project uses ${lic}. GPL code can't simply be relicensed: remove it, rewrite it, or change the project's license.`);
      });
    }
    return out;
  }

  return { scan, distance, lookalike, npmDeps, pyDeps, projectLicense, NPM_POPULAR, PYPI_POPULAR, PY_STDLIB, DEPRECATED };
});
