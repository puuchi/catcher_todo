// Isolated Electron regression tests for todo drafts, notes and persistence.
const fs = require('fs')
const os = require('os')
const path = require('path')
const assert = require('node:assert/strict')

if (!process.versions.electron) {
  const { spawnSync } = require('child_process')
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'floatodo-notes-'))
  try {
    fs.writeFileSync(path.join(directory, 'todos.json'), JSON.stringify([{id:'legacy',text:'旧待办',done:false}]), 'utf8')
    const env = {...process.env, FLOATODO_TODO_TEST_DATA:directory}
    delete env.ELECTRON_RUN_AS_NODE
    const result = spawnSync(require('electron'), [__filename], {env,encoding:'utf8',timeout:45000,windowsHide:true})
    process.stdout.write(result.stdout || '')
    if (result.status !== 0) throw new Error(result.stderr || result.error?.message || `Electron exit ${result.status}`)
  } finally {
    fs.rmSync(directory, {recursive:true,force:true,maxRetries:5,retryDelay:200})
  }
} else {
  const {app,BrowserWindow,ipcMain} = require('electron')
  app.setPath('userData', process.env.FLOATODO_TODO_TEST_DATA)
  app.setName('FloatodoTodoNotesTest')
  require(path.join(__dirname,'../src/main'))
  const delay = milliseconds => new Promise(resolve=>setTimeout(resolve,milliseconds))
  async function until(predicate) {
    for (let count=0;count<100;count++) {
      const value = await predicate()
      if (value) return value
      await delay(30)
    }
    throw new Error('Timed out waiting for todo UI state')
  }
  app.whenReady().then(async () => {
    const window = BrowserWindow.getAllWindows()[0]
    const evaluate = code => window.webContents.executeJavaScript(code,true)
    await until(async ()=>!window.webContents.isLoading() && await evaluate("Boolean(document.querySelector('#todoList [data-id=legacy]'))"))
    assert.equal(await evaluate("document.getElementById('todoComposer').hidden"),true)
    assert.equal(await evaluate("document.querySelector('.todo-toolbar').hidden"),false)
    await evaluate("document.querySelector('[data-id=legacy] .todo-notes-toggle').click()")
    assert.equal(await evaluate("document.querySelector('[data-id=legacy] .todo-notes-toggle').getAttribute('aria-expanded')"),'true')
    assert.equal(await evaluate("document.querySelector('[data-id=legacy] .todo-notes').textContent.includes('undefined')"),false)
    await evaluate("document.querySelector('[data-id=legacy] .todo-notes-toggle').click()")
    assert.equal(await evaluate("document.querySelector('[data-id=legacy] .todo-notes-toggle').getAttribute('aria-expanded')"),'false')

    const originalSave = ipcMain._invokeHandlers.get('save-todos')
    assert.equal(typeof originalSave,'function')
    let release
    const gate = new Promise(resolve=>{release=resolve})
    ipcMain.removeHandler('save-todos')
    ipcMain.handle('save-todos',async (event,todos)=>{await gate;return originalSave(event,todos)})
    const initialNotes = '<img src=x onerror=alert(1)>\n第二行 & 细节'
    try {
      await evaluate("document.getElementById('newTodoBtn').click()")
      assert.equal(await evaluate("document.querySelector('.todo-toolbar').hidden"),true)
      assert.equal(await evaluate("document.getElementById('todoNotes').maxLength"),2000)
      await evaluate(`document.getElementById('todoInput').value='带备注待办';document.getElementById('todoNotes').value=${JSON.stringify(initialNotes)};document.getElementById('createTodoBtn').click()`)
      await until(()=>evaluate("document.getElementById('createTodoBtn').disabled"))
      assert.equal(await evaluate("document.getElementById('createTodoBtn').textContent"),'正在创建…')
      assert.equal(await evaluate("document.querySelector('.todo-toolbar').hidden"),true)
      assert.equal((await evaluate('window.api.loadTodos()')).length,1)
      release()
      await until(()=>evaluate("document.getElementById('todoComposer').hidden"))
      assert.equal(await evaluate("document.querySelector('.todo-toolbar').hidden"),false)
    } finally {
      release()
      ipcMain.removeHandler('save-todos')
      ipcMain.handle('save-todos',originalSave)
    }
    const created = (await evaluate('window.api.loadTodos()')).find(todo=>todo.text==='带备注待办')
    assert.equal(created.notes,initialNotes)
    const row = `#todoList [data-id="${created.id}"]`
    const click = async selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`)
    await click(row+' .todo-notes-toggle')
    assert.equal(await evaluate(`document.querySelector(${JSON.stringify(row+' .todo-notes')}).textContent`),initialNotes)
    assert.equal(await evaluate(`document.querySelectorAll(${JSON.stringify(row+' .todo-notes img')}).length`),0)
    assert.ok(await evaluate(`['pre-wrap','pre-line','break-spaces'].includes(getComputedStyle(document.querySelector(${JSON.stringify(row+' .todo-notes')})).whiteSpace)`))
    await click(row+' .todo-notes-edit')
    assert.equal(await evaluate(`document.querySelector(${JSON.stringify(row+' .edit-notes')}).value`),initialNotes)
    await evaluate(`document.querySelector(${JSON.stringify(row+' .edit-notes')}).value='不保存的草稿'`)
    await click(row+' .cancel-notes')
    assert.equal((await evaluate('window.api.loadTodos()')).find(todo=>todo.id===created.id).notes,initialNotes)

    await click(row+' .todo-notes-edit')
    const revisedNotes = '修改备注\n保留换行 <script>bad()</script>'
    await evaluate(`document.querySelector(${JSON.stringify(row+' .edit-notes')}).value=${JSON.stringify(revisedNotes)}`)
    ipcMain.removeHandler('save-todos')
    ipcMain.handle('save-todos',()=>{throw new Error('Injected notes save failure')})
    try {
      await click(row+' .save-notes')
      await until(()=>evaluate(`Boolean(document.querySelector(${JSON.stringify(row+' .todo-notes-error')})?.textContent.includes('Injected notes save failure'))`))
      assert.equal(await evaluate(`document.querySelector(${JSON.stringify(row+' .edit-notes')}).value`),revisedNotes)
      assert.equal((await evaluate('window.api.loadTodos()')).find(todo=>todo.id===created.id).notes,initialNotes)
    } finally {
      ipcMain.removeHandler('save-todos')
      ipcMain.handle('save-todos',originalSave)
    }
    await click(row+' .save-notes')
    await until(async ()=>(await evaluate('window.api.loadTodos()')).find(todo=>todo.id===created.id).notes===revisedNotes)
    await until(()=>evaluate(`!document.querySelector(${JSON.stringify(row+' .edit-notes')})`))

    window.webContents.reload()
    await until(async ()=>!window.webContents.isLoading() && await evaluate(`Boolean(document.querySelector(${JSON.stringify(row)})) && Boolean(window.api)`))
    await click(row+' .todo-notes-toggle')
    assert.equal(await evaluate(`document.querySelector(${JSON.stringify(row+' .todo-notes')}).textContent`),revisedNotes)
    await click(row+' .todo-delete')
    await until(async ()=>(await evaluate('window.api.loadTodoTrash()')).some(todo=>todo.id===created.id))
    assert.equal((await evaluate('window.api.loadTodoTrash()')).find(todo=>todo.id===created.id).notes,revisedNotes)
    assert.equal((await evaluate(`window.api.todoTrashAction('restore',${JSON.stringify(created.id)})`)).ok,true)
    await evaluate("window.dispatchEvent(new Event('todos-changed'))")
    await until(()=>evaluate(`Boolean(document.querySelector(${JSON.stringify(row)}))`))
    assert.equal((await evaluate('window.api.loadTodos()')).find(todo=>todo.id===created.id).notes,revisedNotes)

    await click(row+' input[type=checkbox]')
    await until(async ()=>(await evaluate('window.api.loadTodos()')).find(todo=>todo.id===created.id).done)
    await click(row+' .todo-notes-toggle')
    await click(row+' .todo-notes-edit')
    await evaluate(`document.querySelector(${JSON.stringify(row+' .edit-notes')}).value='完成后仍可修改'`)
    await click(row+' .save-notes')
    await until(async ()=>(await evaluate('window.api.loadTodos()')).find(todo=>todo.id===created.id).notes==='完成后仍可修改')
    await click('#clearDone')
    await until(async ()=>(await evaluate('window.api.loadArchive()')).some(todo=>todo.id===created.id))
    assert.equal((await evaluate('window.api.loadArchive()')).find(todo=>todo.id===created.id).notes,'完成后仍可修改')
    await click('#historyBtn')
    await until(()=>evaluate("Boolean(document.querySelector('#todoList .todo-notes-toggle'))"))
    await click('#todoList .todo-notes-toggle')
    assert.equal(await evaluate("document.querySelector('#todoList .todo-notes').textContent"),'完成后仍可修改')
    assert.equal(await evaluate("document.querySelectorAll('#todoList .todo-notes-edit').length"),0)
    console.log('PASS todo notes: draft feedback, legacy records, escaped multiline display, edit/cancel/error/retry, reload, recycle, completed items and archive')
    app.quit()
  }).catch(error=>{console.error(error.stack);process.exit(1)})
}
