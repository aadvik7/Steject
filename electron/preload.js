// STEJECT desktop app — the only bridge between the page and the computer.
// The page gets these few functions and nothing else (no Node, no file system).
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("steNative", {
  isDesktop: true,
  platform: process.platform,
  secrets: {
    get: key => ipcRenderer.invoke("secrets:get", key),
    set: (key, value) => ipcRenderer.invoke("secrets:set", key, value),
    del: key => ipcRenderer.invoke("secrets:del", key),
  },
  saveFile: (name, bytes) => ipcRenderer.invoke("save-file", name, bytes),
  copy: text => ipcRenderer.invoke("copy", text),
  setTheme: theme => ipcRenderer.invoke("theme", theme),
  info: () => ipcRenderer.invoke("info"),
  allowHost: url => ipcRenderer.invoke("net:allow", url),
  checks: {
    detect: () => ipcRenderer.invoke("checks:detect"),
    run: (files, opts) => ipcRenderer.invoke("checks:run", { files, ...(opts || {}) }),
  },
  onMenu: cb => { ipcRenderer.on("menu", (_e, cmd) => cb(cmd)); },
});
