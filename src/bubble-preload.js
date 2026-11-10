const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
  getActivities: () => ipcRenderer.invoke('activity-get'),
  onActivities: callback => {
    const listener = (_, state) => callback(state)
    ipcRenderer.on('activity-changed', listener)
    return () => ipcRenderer.removeListener('activity-changed', listener)
  },
  moveWindow:  (x, y) => ipcRenderer.send('bubble-move', x, y),
  restoreMain: ()     => ipcRenderer.send('restore-from-bubble')
})
