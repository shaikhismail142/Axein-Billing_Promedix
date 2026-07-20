const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("axeinDesktop", {
  onStatus(callback) {
    ipcRenderer.on("axein-status", (_event, status) => callback(status));
  },
});
