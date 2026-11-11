const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, powerMonitor, screen, dialog } = require('electron')
const path = require('path')
const fs = require('fs')
const { ActivityStore, atomicSave } = require('./activity-store')
const { clampBounds } = require('./window-position')

let mainWindow
let bubbleWindow
let tray
let activityStore
let checkpointTimer
let windowStore
let isQuitting = false
let quitPending = false
let positionSaveTimer
const pendingPositions = new Map()
const completedRequests = new Map()

function reportFailure(context, error) {
  console.error(`[${context}]`, error)
  dialog.showErrorBox('FloatTodo 保存失败', `${context}\n${error.message}\n请检查磁盘空间、文件权限和配置文件。应用将保留当前状态。`)
}

function queuePosition(key, window) {
  if (!window || window.isDestroyed() || !windowStore) return
  pendingPositions.set(key, window.getBounds())
  clearTimeout(positionSaveTimer)
  positionSaveTimer = setTimeout(() => {
    try { flushPositions() } catch (error) { reportFailure('保存窗口位置失败', error) }
  }, 300)
}

function flushPositions() {
  clearTimeout(positionSaveTimer)
  for (const [key, bounds] of pendingPositions) {
    windowStore.set(key, bounds)
    pendingPositions.delete(key)
  }
}

function fitWindow(window, key) {
  if (!window || window.isDestroyed()) return
  applyWindowBounds(window, window.getBounds())
  queuePosition(key, window)
}

function applyWindowBounds(window, bounds) {
  const fitted = clampBounds(bounds, screen.getAllDisplays())
  if (window === mainWindow) window.setMinimumSize(Math.min(260, fitted.width), Math.min(300, fitted.height))
  window.setBounds(fitted)
}

function handleDisplayChange() {
  console.info('[display-change] Rechecking window positions', screen.getAllDisplays().map(display => ({ id: display.id, workArea: display.workArea })))
  fitWindow(mainWindow, 'windowBounds')
  fitWindow(bubbleWindow, 'bubbleBounds')
}

async function finishQuit() {
  // Let the cancelled before-quit event unwind before attempting another quit.
  await Promise.resolve()
  try {
    const running = activityStore?.current()
    if (running?.status === 'running') {
      const owner = bubbleWindow?.isVisible() ? bubbleWindow : mainWindow
      const options = {
        type: 'question',
        title: '退出 FloatTodo',
        message: `“${running.name}”正在计时，是否暂停并退出？`,
        detail: '暂停后会保存本次已记录的时间，下次打开可继续计时。',
        buttons: ['取消', '暂停并退出'],
        defaultId: 0,
        cancelId: 0,
        noLink: true
      }
      const result = owner ? await dialog.showMessageBox(owner, options) : await dialog.showMessageBox(options)
      if (result.response !== 1) {
        console.info('[quit] Cancelled by user')
        return
      }
    }
    activityStore?.pause('quit')
    activityStore?.checkpoint()
    if (activityStore) publishActivities()
    queuePosition('windowBounds', mainWindow)
    queuePosition('bubbleBounds', bubbleWindow)
    flushPositions()
    isQuitting = true
    console.info('[quit] Activity and window positions saved; exiting')
    clearInterval(checkpointTimer)
    app.quit()
  } catch (error) {
    reportFailure('退出前保存失败，应用尚未退出', error)
  } finally {
    quitPending = false
  }
}

function publishActivities() {
  const snapshot = activityStore.snapshot()
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('activity-changed', snapshot)
  if (bubbleWindow && !bubbleWindow.isDestroyed()) {
    bubbleWindow.webContents.send('activity-changed', snapshot)
  }
}

function pauseActivities(reason) {
  try {
    activityStore?.pause(reason)
  } catch (error) {
    console.error('[activity-pause] Failed to persist interruption', { reason, error })
    // Fail closed even if the disk is unavailable during a system interruption.
    const current = activityStore.current()
    if (current?.status === 'running') {
      activityStore.closeSegment(current, Date.now())
      current.status = 'paused'
      current.pauseReason = reason
      activityStore.needsFlush = true
    }
    activityStore.notice = error.message
  }
  if (activityStore) publishActivities()
}

const dataPath    = path.join(app.getPath('userData'), 'todos.json')
const archivePath = path.join(app.getPath('userData'), 'archive.json')

function readTodoRecords() {
  if (!fs.existsSync(dataPath)) return []
  const records = JSON.parse(fs.readFileSync(dataPath, 'utf8'))
  if (!Array.isArray(records)) throw new Error('待办文件格式无效，已停止写入以保护原文件')
  return records
}

function loadTodos() {
  try {
    return readTodoRecords().filter(todo => !todo.deletedAt)
  } catch (e) {}
  return []
}

function saveTodos(todos) {
  if (!Array.isArray(todos)) throw new Error('待办数据无效')
  const deleted = readTodoRecords().filter(todo => todo.deletedAt)
  const deletedIds = new Set(deleted.map(todo => todo.id))
  atomicSave(dataPath, [...todos.filter(todo => !deletedIds.has(todo.id)), ...deleted])
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 320,
    height: 480,
    minWidth: 260,
    minHeight: 300,
    frame: false,           // 无标题栏
    transparent: true,      // 背景透明
    alwaysOnTop: true,      // 始终悬浮在顶层
    resizable: true,
    skipTaskbar: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  })

  mainWindow.loadFile(path.join(__dirname, 'index.html'))

  const bounds = windowStore.get('windowBounds')
  if (bounds) {
    applyWindowBounds(mainWindow, bounds)
  }

  mainWindow.on('moved', () => {
    queuePosition('windowBounds', mainWindow)
  })
  mainWindow.on('resized', () => {
    queuePosition('windowBounds', mainWindow)
  })

  mainWindow.on('close', event => {
    if (isQuitting) return
    event.preventDefault()
    minimizeToBubble()
  })
  mainWindow.on('closed', () => {
    mainWindow = null
  })
  mainWindow.on('session-end', () => pauseActivities('shutdown'))
}

function createTray() {
  // 使用空图标（实际项目可替换为真实图标）
  const icon = nativeImage.createEmpty()
  tray = new Tray(icon)
  const contextMenu = Menu.buildFromTemplate([
    { label: '显示', click: () => mainWindow && mainWindow.show() },
    { label: '隐藏', click: () => mainWindow && mainWindow.hide() },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() }
  ])
  tray.setToolTip('FloatTodo')
  tray.setContextMenu(contextMenu)
  tray.on('click', () => {
    if (mainWindow) {
      mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show()
    }
  })
}

const hasInstanceLock = app.requestSingleInstanceLock()
if (!hasInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    restoreFromBubble()
  })

app.whenReady().then(() => {
  if (process.platform === 'darwin' && app.dock) {
    app.dock.show()
  }
  activityStore = new ActivityStore(path.join(app.getPath('userData'), 'activity-log.json'))
  const Store = require('./store')
  windowStore = new Store()
  for (const key of ['windowBounds', 'bubbleBounds']) {
    const saved = windowStore.get(key)
    if (saved !== undefined) clampBounds(saved, screen.getAllDisplays())
  }
  createWindow()
  screen.on('display-added', handleDisplayChange)
  screen.on('display-removed', handleDisplayChange)
  screen.on('display-metrics-changed', handleDisplayChange)
  powerMonitor.on('lock-screen', () => pauseActivities('lock'))
  powerMonitor.on('suspend', () => pauseActivities('sleep'))
  powerMonitor.on('shutdown', () => pauseActivities('shutdown'))
  checkpointTimer = setInterval(() => {
    try {
      activityStore.checkpoint()
      publishActivities()
    } catch (error) {
      pauseActivities('save-error')
      activityStore.notice = error.message
      publishActivities()
    }
  }, 30000)
  // createTray() // 需要图标资源时可开启
}).catch(error => {
  console.error('[startup] Unable to initialize application', error)
  dialog.showErrorBox('FloatTodo 启动失败', `无法读取配置或创建窗口，原文件未被覆盖。\n${error.message}`)
  app.exit(1)
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (!mainWindow) createWindow()
})

app.on('before-quit', event => {
  if (isQuitting) return
  event.preventDefault()
  if (quitPending) return
  quitPending = true
  void finishQuit()
})

}

// IPC 通信：读写 todos
ipcMain.handle('load-todos', () => loadTodos())
ipcMain.handle('save-todos', (_, todos) => saveTodos(todos))

ipcMain.handle('load-todo-trash', event => {
  if (event.sender !== mainWindow?.webContents) throw new Error('未知窗口')
  return readTodoRecords().filter(todo => todo.deletedAt)
})
ipcMain.handle('todo-trash-action', (event, { type, id } = {}) => {
  if (event.sender !== mainWindow?.webContents) return { ok: false, error: '未知窗口' }
  try {
    const records = readTodoRecords()
    const todo = records.find(todo => todo.id === id)
    if (!todo) throw new Error('待办已不存在，请刷新列表')
    if (type === 'trash') todo.deletedAt = todo.deletedAt || new Date().toISOString()
    else if (type === 'restore') delete todo.deletedAt
    else if (type === 'delete') {
      if (!todo.deletedAt) throw new Error('请先将待办移入回收站')
      records.splice(records.indexOf(todo), 1)
    }
    else throw new Error('未知回收站操作')
    atomicSave(dataPath, records)
    return { ok: true }
  } catch (error) {
    return { ok: false, error: `操作未保存：${error.message}` }
  }
})

// IPC 通信：读写 archive
ipcMain.handle('load-archive', () => {
  try {
    if (fs.existsSync(archivePath)) {
      return JSON.parse(fs.readFileSync(archivePath, 'utf8'))
    }
  } catch (e) {}
  return []
})
ipcMain.handle('save-archive', (_, archive) => {
  fs.writeFileSync(archivePath, JSON.stringify(archive), 'utf8')
})

// IPC 通信：窗口控制
ipcMain.on('window-minimize', () => mainWindow && mainWindow.minimize())
ipcMain.on('window-close', minimizeToBubble)
ipcMain.on('window-pin', (_, pinned) => mainWindow && mainWindow.setAlwaysOnTop(pinned))

ipcMain.handle('appearance-get', event => {
  if (event.sender !== mainWindow?.webContents) throw new Error('未知窗口')
  const value = windowStore.get('backgroundTransparency')
  return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 45
})
ipcMain.handle('appearance-save', (event, value) => {
  if (event.sender !== mainWindow?.webContents) return { ok: false, error: '未知窗口' }
  if (!Number.isInteger(value) || value < 0 || value > 100) return { ok: false, error: '透明度须介于 0% 和 100% 之间' }
  try {
    windowStore.set('backgroundTransparency', value)
    return { ok: true }
  } catch {
    return { ok: false, error: '保存失败，请检查磁盘空间和目录权限' }
  }
})

ipcMain.handle('activity-get', event => {
  if (event.sender !== mainWindow?.webContents && event.sender !== bubbleWindow?.webContents) throw new Error('未知窗口')
  return activityStore.snapshot()
})

ipcMain.handle('activity-command', (event, command) => {
  if (event.sender !== mainWindow?.webContents) return { ok: false, error: '未知窗口' }
  try {
    if (!command || typeof command.requestId !== 'string' || command.requestId.length > 100) throw new Error('无效的操作请求')
    if (completedRequests.has(command.requestId)) return { ok: true, state: activityStore.snapshot() }
    const { type, payload = {} } = command
    switch (type) {
      case 'start': activityStore.start(payload.name, payload.todoId); break
      case 'pause': activityStore.pause(); break
      case 'resume': activityStore.resume(payload.id); break
      case 'end': activityStore.end(payload.id); break
      case 'edit': activityStore.edit(payload); break
      case 'remove': activityStore.remove(payload.id); break
      case 'progress': activityStore.setProgress(payload.activityId,payload.sessionId,payload.progress); break
      case 'matter-edit': activityStore.updateMatter(payload.id,payload); break
      case 'session-edit': activityStore.editSession(payload); break
      case 'session-delete': activityStore.deleteSession(payload.activityId,payload.sessionId); break
      case 'session-add': activityStore.addSession(payload); break
      case 'trash-restore': activityStore.restoreTrash(payload.id); break
      case 'trash-delete': activityStore.deleteTrash(payload.id); break
      default: throw new Error('未知活动操作')
    }
    completedRequests.set(command.requestId, true)
    if (completedRequests.size > 128) completedRequests.delete(completedRequests.keys().next().value)
    publishActivities()
    return { ok: true, state: activityStore.snapshot() }
  } catch (error) {
    return { ok: false, error: error.message, state: activityStore.snapshot() }
  }
})
ipcMain.on('app-quit', event => {
  if (event.sender === mainWindow?.webContents) app.quit()
})

// IPC 通信：悬浮球
function minimizeToBubble() {
  if (!mainWindow) return
  if (bubbleWindow) { mainWindow.hide(); bubbleWindow.show(); return }
  const bounds = mainWindow.getBounds()
  const saved = windowStore.get('bubbleBounds')
  const bubbleBounds = clampBounds(saved ? { ...saved, width: 36, height: 36 } : {
    width: 36, height: 36,
    x: bounds.x + bounds.width / 2 - 18, y: bounds.y
  }, screen.getAllDisplays())
  bubbleWindow = new BrowserWindow({
    width: 36,
    height: 36,
    x: bubbleBounds.x,
    y: bubbleBounds.y,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'bubble-preload.js')
    }
  })
  bubbleWindow.loadFile(path.join(__dirname, 'bubble.html'))
  bubbleWindow.on('moved', () => queuePosition('bubbleBounds', bubbleWindow))
  bubbleWindow.on('close', event => {
    if (isQuitting) return
    try {
      queuePosition('bubbleBounds', bubbleWindow)
      flushPositions()
    } catch (error) {
      event.preventDefault()
      reportFailure('保存悬浮窗位置失败', error)
    }
  })
  bubbleWindow.on('closed', () => { bubbleWindow = null })
  mainWindow.hide()
}

function restoreFromBubble() {
  if (!mainWindow) return
  fitWindow(mainWindow, 'windowBounds')
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
  if (bubbleWindow) bubbleWindow.close()
}

ipcMain.on('minimize-to-bubble', minimizeToBubble)

ipcMain.on('bubble-move', (event, x, y) => {
  if (event.sender !== bubbleWindow?.webContents) return
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    console.error('[bubble-move] Invalid window coordinates', { x, y })
    return
  }
  const bounds = clampBounds({ ...bubbleWindow.getBounds(), x, y }, screen.getAllDisplays())
  bubbleWindow.setPosition(bounds.x, bounds.y)
})

ipcMain.on('restore-from-bubble', event => {
  if (event.sender === bubbleWindow?.webContents) restoreFromBubble()
})

ipcMain.on('bubble-context-menu', event => {
  if (event.sender !== bubbleWindow?.webContents) return
  Menu.buildFromTemplate([
    { label: '打开', click: restoreFromBubble },
    { type: 'separator' },
    { label: '关闭', click: () => app.quit() }
  ]).popup({ window: bubbleWindow })
})
