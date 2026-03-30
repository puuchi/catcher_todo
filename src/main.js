const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage } = require('electron')
const path = require('path')
const fs = require('fs')

let mainWindow
let bubbleWindow
let tray

const dataPath    = path.join(app.getPath('userData'), 'todos.json')
const archivePath = path.join(app.getPath('userData'), 'archive.json')

function loadTodos() {
  try {
    if (fs.existsSync(dataPath)) {
      return JSON.parse(fs.readFileSync(dataPath, 'utf8'))
    }
  } catch (e) {}
  return []
}

function saveTodos(todos) {
  fs.writeFileSync(dataPath, JSON.stringify(todos), 'utf8')
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

  // 记住窗口位置
  const Store = require('./store')
  const store = new Store()
  const bounds = store.get('windowBounds')
  if (bounds) {
    mainWindow.setBounds(bounds)
  }

  mainWindow.on('moved', () => {
    store.set('windowBounds', mainWindow.getBounds())
  })
  mainWindow.on('resized', () => {
    store.set('windowBounds', mainWindow.getBounds())
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
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

app.whenReady().then(() => {
  if (process.platform === 'darwin' && app.dock) {
    app.dock.show()
  }
  createWindow()
  // createTray() // 需要图标资源时可开启
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (!mainWindow) createWindow()
})

// IPC 通信：读写 todos
ipcMain.handle('load-todos', () => loadTodos())
ipcMain.handle('save-todos', (_, todos) => saveTodos(todos))

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
ipcMain.on('window-close', () => mainWindow && mainWindow.hide())
ipcMain.on('window-pin', (_, pinned) => mainWindow && mainWindow.setAlwaysOnTop(pinned))

// IPC 通信：悬浮球
ipcMain.on('minimize-to-bubble', () => {
  if (!mainWindow) return
  const bounds = mainWindow.getBounds()
  bubbleWindow = new BrowserWindow({
    width: 36,
    height: 36,
    x: Math.round(bounds.x + bounds.width / 2 - 18),
    y: bounds.y,
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
  bubbleWindow.on('closed', () => { bubbleWindow = null })
  mainWindow.hide()
})

ipcMain.on('bubble-move', (_, x, y) => {
  if (bubbleWindow) bubbleWindow.setPosition(Math.round(x), Math.round(y))
})

ipcMain.on('restore-from-bubble', () => {
  if (mainWindow) { mainWindow.show(); mainWindow.focus() }
  if (bubbleWindow) { bubbleWindow.close() }
})
