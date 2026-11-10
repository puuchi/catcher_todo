const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
  getTransparency: () => ipcRenderer.invoke('appearance-get'),
  saveTransparency: value => ipcRenderer.invoke('appearance-save', value),
  getActivities: () => ipcRenderer.invoke('activity-get'),
  activityCommand: command => ipcRenderer.invoke('activity-command', command),
  onActivities: callback => {
    const listener = (_, state) => callback(state)
    ipcRenderer.on('activity-changed', listener)
    return () => ipcRenderer.removeListener('activity-changed', listener)
  },
  quit: () => ipcRenderer.send('app-quit'),
  loadTodos: () => ipcRenderer.invoke('load-todos'),
  saveTodos: (todos) => ipcRenderer.invoke('save-todos', todos),
  loadTodoTrash: () => ipcRenderer.invoke('load-todo-trash'),
  todoTrashAction: (type, id) => ipcRenderer.invoke('todo-trash-action', { type, id }),
  minimize: () => ipcRenderer.send('window-minimize'),
  close: () => ipcRenderer.send('window-close'),
  setPin: (pinned) => ipcRenderer.send('window-pin', pinned),
  minimizeToBubble: () => ipcRenderer.send('minimize-to-bubble'),
  loadArchive: () => ipcRenderer.invoke('load-archive'),
  saveArchive: (archive) => ipcRenderer.invoke('save-archive', archive)
})
