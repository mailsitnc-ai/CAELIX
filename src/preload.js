'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('caelix', {
  invoke(channel, payload) {
    return ipcRenderer.invoke(channel, payload);
  },
  on(channel, callback) {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },
  platform: process.platform,
});
