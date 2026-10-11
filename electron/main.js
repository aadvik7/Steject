// STEJECT desktop app — Electron main process.
const { app, BrowserWindow, ipcMain, shell, safeStorage, Menu, nativeTheme, session, dialog, clipboard } = require("electron");
const path = require("path");
const fs = require("fs");

const APP_DIR = path.join(__dirname, "..", "app");
const isMac = process.platform === "darwin";

// ---------------------------------------------------------------- build info
function buildInfo() {
  try {
    const src = fs.readFileSync(path.join(APP_DIR, "js", "build-info.js"), "utf8");
    return JSON.parse(src.slice(src.indexOf("{"), src.lastIndexOf("}") + 1));
  } catch { return { version: app.getVersion(), repo: "" }; }
}
const BUILD = buildInfo();

// ---------------------------------------------------------------- single instance
if (!app.requestSingleInstanceLock()) { app.quit(); }
let win = null;
app.on("second-instance", () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

// ---------------------------------------------------------------- small JSON stores in userData
const file = name => path.join(app.getPath("userData"), name);
const readJson = (name, d) => { try { return JSON.parse(fs.readFileSync(file(name), "utf8")); } catch { return d; } };
const writeJson = (name, v) => { try { fs.mkdirSync(app.getPath("userData"), { recursive: true }); fs.writeFileSync(file(name), JSON.stringify(v), { mode: 0o600 }); } catch {} };

// secrets are encrypted with the OS keychain (DPAPI / Keychain / libsecret) when available
function secretsGet(key) {
  const all = readJson("secrets.json", {});
  const rec = all[key];
  if (!rec) return null;
  try {
    const buf = Buffer.from(rec.v, "base64");
    return rec.enc ? safeStorage.decryptString(buf) : buf.toString("utf8");
  } catch { return null; }
}
function secretsSet(key, value) {
  const all = readJson("secrets.json", {});
  if (value == null || value === "") delete all[key];
  else {
    const enc = safeStorage.isEncryptionAvailable();
    all[key] = { enc, v: (enc ? safeStorage.encryptString(String(value)) : Buffer.from(String(value), "utf8")).toString("base64") };
  }
  writeJson("secrets.json", all);
}

// ---------------------------------------------------------------- window
function createWindow() {
  const st = readJson("window.json", { width: 1320, height: 900 });
  const theme = readJson("prefs.json", {}).theme || "system";
  nativeTheme.themeSource = theme;

  win = new BrowserWindow({
    width: st.width || 1320, height: st.height || 900, x: st.x, y: st.y,
    minWidth: 860, minHeight: 600,
    title: "STEJECT",
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#0d1522" : "#eceff3",
    icon: path.join(APP_DIR, "icons", "icon-512.png"),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });
  if (st.maximized) win.maximize();
  win.once("ready-to-show", () => win.show());

  const save = () => {
    if (!win || win.isDestroyed()) return;
    const b = win.getNormalBounds();
    writeJson("window.json", { ...b, maximized: win.isMaximized() });
  };
  win.on("close", save);

  // links open in the user's browser; the app never navigates away
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (!url.startsWith("file://")) { e.preventDefault(); if (/^https?:\/\//.test(url)) shell.openExternal(url); }
  });

  win.loadFile(path.join(APP_DIR, "index.html"));
}

// ---------------------------------------------------------------- network: let the page talk to Ollama, Telegram and Groq
// Browsers block reading replies from these hosts (CORS). The desktop app is
// trusted, so it removes the Origin header on the way out and allows the reply.
// The AI address the user chose in Settings (OpenRouter, Gemini, a college server…) joins the list.
const BASE_HOSTS = ["http://localhost/*", "http://localhost:*/*", "http://127.0.0.1/*", "http://127.0.0.1:*/*", "https://api.telegram.org/*", "https://api.groq.com/*"];
function aiOrigin(url) {
  try {
    const u = new URL(String(url));
    if (u.protocol === "https:" && u.hostname && !u.username && !u.password) return `https://${u.host}`;
  } catch {}
  return null;
}
function allowLocalApis() {
  const extra = readJson("prefs.json", {}).aiOrigin;
  const filter = { urls: [...BASE_HOSTS, ...(aiOrigin(extra) ? [aiOrigin(extra) + "/*"] : [])] };
  session.defaultSession.webRequest.onBeforeSendHeaders(filter, (d, cb) => {
    for (const k of Object.keys(d.requestHeaders)) if (k.toLowerCase() === "origin") delete d.requestHeaders[k];
    cb({ requestHeaders: d.requestHeaders });
  });
  session.defaultSession.webRequest.onHeadersReceived(filter, (d, cb) => {
    const h = d.responseHeaders || {};
    for (const k of Object.keys(h)) if (k.toLowerCase().startsWith("access-control-")) delete h[k];
    h["Access-Control-Allow-Origin"] = ["*"];
    h["Access-Control-Allow-Headers"] = ["*"];
    h["Access-Control-Expose-Headers"] = ["*"];
    h["Access-Control-Allow-Methods"] = ["GET, POST, DELETE, OPTIONS"];
    cb({ responseHeaders: h, statusLine: d.method === "OPTIONS" ? "HTTP/1.1 204 No Content" : d.statusLine });
  });
  // the app needs no camera, mic, location or notifications
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === "clipboard-sanitized-write"));
}

// ---------------------------------------------------------------- IPC
ipcMain.handle("secrets:get", (_e, k) => secretsGet(String(k)));
ipcMain.handle("secrets:set", (_e, k, v) => { secretsSet(String(k), v); return true; });
ipcMain.handle("secrets:del", (_e, k) => { secretsSet(String(k), null); return true; });
ipcMain.handle("copy", (_e, text) => { clipboard.writeText(String(text)); return true; });
ipcMain.handle("theme", (_e, t) => {
  if (!["system", "light", "dark"].includes(t)) return false;
  nativeTheme.themeSource = t;
  writeJson("prefs.json", { ...readJson("prefs.json", {}), theme: t });
  return true;
});
ipcMain.handle("save-file", async (_e, name, bytes) => {
  const safe = path.basename(String(name)).replace(/[^\w.\-]+/g, "_") || "download";
  const r = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath("downloads"), safe) });
  if (r.canceled || !r.filePath) return false;
  await fs.promises.writeFile(r.filePath, Buffer.from(bytes));
  shell.showItemInFolder(r.filePath);
  return true;
});
ipcMain.handle("net:allow", (_e, url) => {
  const origin = aiOrigin(url);
  if (!origin) return false;                       // localhost is already allowed; anything else must be https
  const prefs = readJson("prefs.json", {});
  if (prefs.aiOrigin !== origin) { writeJson("prefs.json", { ...prefs, aiOrigin: origin }); allowLocalApis(); }
  return true;
});
ipcMain.handle("info", () => ({ version: BUILD.version, repo: BUILD.repo, platform: process.platform, encrypted: safeStorage.isEncryptionAvailable() }));

// ---------------------------------------------------------------- menu
function menu() {
  const send = cmd => () => win && win.webContents.send("menu", cmd);
  const repoUrl = BUILD.repo ? `https://github.com/${BUILD.repo}` : null;
  const template = [
    ...(isMac ? [{ role: "appMenu" }] : []),
    {
      label: "File",
      submenu: [
        { label: "Open manifest…", accelerator: "CmdOrCtrl+O", click: send("open") },
        { type: "separator" },
        isMac ? { role: "close" } : { role: "quit" },
      ],
    },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        { label: "Ship", accelerator: "CmdOrCtrl+1", click: send("ship") },
        { label: "Learn", accelerator: "CmdOrCtrl+2", click: send("learn") },
        { label: "History", accelerator: "CmdOrCtrl+3", click: send("history") },
        { label: "Settings", accelerator: "CmdOrCtrl+4", click: send("settings") },
        { type: "separator" },
        { role: "reload" }, { role: "toggleDevTools" }, { type: "separator" },
        { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }, { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    { role: "windowMenu" },
    {
      role: "help",
      submenu: [
        { label: "Check for updates", click: send("check-updates"), enabled: !!repoUrl },
        { label: "STEJECT on GitHub", click: () => repoUrl && shell.openExternal(repoUrl), enabled: !!repoUrl },
        { label: "Report a problem", click: () => repoUrl && shell.openExternal(repoUrl + "/issues/new"), enabled: !!repoUrl },
        { type: "separator" },
        { label: "Download Ollama (local AI)", click: () => shell.openExternal("https://ollama.com/download") },
        { label: "Create a GitHub token", click: () => shell.openExternal("https://github.com/settings/tokens/new?scopes=repo&description=STEJECT") },
        ...(!isMac ? [{ type: "separator" }, { label: `About STEJECT v${BUILD.version}`, click: () => dialog.showMessageBox(win, { type: "info", title: "About STEJECT", message: `STEJECT v${BUILD.version}`, detail: "Turn chat-made projects into real GitHub repos.\nOpen source, MIT license." }) }] : []),
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------------------------------------------------------------- lifecycle
app.setAboutPanelOptions && app.setAboutPanelOptions({ applicationName: "STEJECT", applicationVersion: BUILD.version, copyright: "MIT License" });
app.whenReady().then(() => {
  allowLocalApis();
  menu();
  createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on("window-all-closed", () => { if (!isMac) app.quit(); });
app.on("web-contents-created", (_e, wc) => {
  wc.on("will-attach-webview", e => e.preventDefault());
});
