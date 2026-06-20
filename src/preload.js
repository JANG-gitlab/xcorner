'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('xc', {
  cornerInfo: () => ipcRenderer.invoke('corner:info'),
  settingsGet: () => ipcRenderer.invoke('settings:get'),
  addFolder: () => ipcRenderer.invoke('source:addFolder'),
  addFile: () => ipcRenderer.invoke('source:addFile'),
  addUrl: (raw) => ipcRenderer.invoke('source:addUrl', raw),
  clearSources: () => ipcRenderer.invoke('source:clear'),
  mediaList: () => ipcRenderer.invoke('media:list'),
  tiktokAvailable: () => ipcRenderer.invoke('tiktok:available'),
  tiktokCategories: () => ipcRenderer.invoke('tiktok:categories'),
  tiktokGet: () => ipcRenderer.invoke('tiktok:get'),
  tiktokAdd: (cat, url, mode) => ipcRenderer.invoke('tiktok:add', cat, url, mode),
  tiktokRemove: (cat, url) => ipcRenderer.invoke('tiktok:remove', cat, url),
  tiktokReset: () => ipcRenderer.invoke('tiktok:reset'),
  tiktokPool: (cat) => ipcRenderer.invoke('tiktok:pool', cat),
  tiktokFetch: (id, url) => ipcRenderer.invoke('tiktok:fetch', id, url),
  tiktokPrefetch: (id, url) => ipcRenderer.invoke('tiktok:prefetch', id, url),
  captureList: () => ipcRenderer.invoke('capture:list'),
  capturePermission: () => ipcRenderer.invoke('capture:permission'),
  captureOpenSettings: () => ipcRenderer.invoke('capture:openSettings'),
  setMode: (mode) => ipcRenderer.invoke('window:mode', mode),
  newWindow: () => ipcRenderer.invoke('window:new'),
  close: () => ipcRenderer.invoke('window:close'),
  quit: () => ipcRenderer.invoke('app:quit'),
  mediaUrl: (id) => 'xmedia://media/' + encodeURIComponent(id)
});
