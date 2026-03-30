const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
  loadTodos: () => ipcRenderer.invoke('load-todos'),
  saveTodos: (todos) => ipcRenderer.invoke('save-todos', todos),
  minimize: () => ipcRenderer.send('window-minimize'),
  close: () => ipcRenderer.send('window-close'),
  setPin: (pinned) => ipcRenderer.send('window-pin', pinned),
  minimizeToBubble: () => ipcRenderer.send('minimize-to-bubble'),
  loadArchive: () => ipcRenderer.invoke('load-archive'),
  saveArchive: (archive) => ipcRenderer.invoke('save-archive', archive)
})
