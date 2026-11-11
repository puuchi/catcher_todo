let todos = []
let archive = []
let pinned = true
let isUrgent = false
let editingId = null
let showHistory = false
let todoMutationBusy = false
let editingNotesId = null
const expandedNotes = new Set()

const todoInput        = document.getElementById('todoInput')
const todoList         = document.getElementById('todoList')
const statusText       = document.getElementById('statusText')
const clearDoneBtn     = document.getElementById('clearDone')
const historyBtn       = document.getElementById('historyBtn')
const btnBack          = document.getElementById('btnBack')
const btnPin           = document.getElementById('btnPin')
const btnMin           = document.getElementById('btnMin')
const btnClose         = document.getElementById('btnClose')
const newTodoBtn       = document.getElementById('newTodoBtn')
const todoComposer     = document.getElementById('todoComposer')
const cancelTodoBtn    = document.getElementById('cancelTodoBtn')
const createTodoBtn    = document.getElementById('createTodoBtn')
const todoCreateError  = document.getElementById('todoCreateError')
const todoNotes        = document.getElementById('todoNotes')
const todoToolbar      = document.querySelector('.todo-toolbar')
const optUrgent        = document.getElementById('optUrgent')
const deadlineInput    = document.getElementById('deadlineInput')
const optDeadlineLabel = document.getElementById('optDeadlineLabel')

function todayStr() {
  return ActivityTime.localDate()
}

async function init() {
  todos = await window.api.loadTodos()
  archive = await window.api.loadArchive()
  render()
}

function render() {
  // Rendering replaces the editors, so their state must follow the DOM lifecycle.
  editingId = null
  editingNotesId = null
  document.getElementById('todoHeadingLabel').textContent = '待办清单'
  document.getElementById('todoEyebrow').textContent = 'A LITTLE MORE FOCUS'
  document.getElementById('todoCount').textContent = todos.filter(todo => !todo.done).length
  historyBtn.style.display = ''
  clearDoneBtn.style.display = ''
  statusText.style.display = ''
  btnBack.style.display = 'none'
  if (showHistory) { renderHistory(); return }
  const today = todayStr()

  // 只显示：未完成 + 当日完成
  const visible = todos.filter(t => !t.done || t.completedAt === today)

  // 排序：未完成在前（紧急 > 今日截止 > 其他），完成在后
  visible.sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1
    if (!a.done) {
      if (a.urgent !== b.urgent) return a.urgent ? -1 : 1
      const aToday = a.deadline === today
      const bToday = b.deadline === today
      if (aToday !== bToday) return aToday ? -1 : 1
    }
    return 0
  })

  if (visible.length === 0) {
    todoList.innerHTML = `<div class="empty-hint todo-empty"><div class="empty-illustration" aria-hidden="true"><svg viewBox="0 0 64 70" fill="none"><path d="M18 12h28l4 4v43H14V16z" fill="#fffef7" stroke="#bbc7aa" stroke-width="1.3"/><rect x="24" y="8" width="16" height="8" rx="3" fill="#d6dfc5" stroke="#a5b592"/><path d="m23 32 5 5 12-13" stroke="#6c8a5c" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M23 46h18M23 51h12" stroke="#d1d9c5" stroke-width="1.5" stroke-linecap="round"/></svg></div><strong>暂无待办，留点空白</strong><p>把想做的事记下来，慢慢完成。</p></div>`
    statusText.textContent = ''
    return
  }

  let html = ''
  let hasDoneDivider = false

  visible.forEach(t => {
    if (t.done && !hasDoneDivider) {
      html += `<li class="section-divider">今日已完成</li>`
      hasDoneDivider = true
    }

    const isDeadlineToday = !t.done && t.deadline === today
    const isOverdue = !t.done && t.deadline && t.deadline < today

    let cls = 'todo-item'
    if (t.done) cls += ' done'
    if (t.urgent && !t.done) cls += ' urgent'
    if (isDeadlineToday) cls += ' deadline-today'
    if (isOverdue) cls += ' overdue'

    const urgentBadge = (t.urgent && !t.done)
      ? `<span class="urgent-badge">急</span>` : ''

    let deadlineBadge = ''
    if (t.deadline && !t.done) {
      const badgeCls = isDeadlineToday ? 'today' : isOverdue ? 'overdue' : ''
      deadlineBadge = `<span class="deadline-badge ${badgeCls}">${formatDate(t.deadline, today)}</span>`
    }

    html += `
      <li class="${cls}" data-id="${t.id}">
        <input type="checkbox" ${t.done ? 'checked' : ''} />
        <div class="todo-content">
          <div class="todo-main">
            <span class="todo-text">${escapeHtml(t.text)}</span>${urgentBadge}${deadlineBadge}${notesToggle(t)}
          </div>
          ${notesPanel(t)}
        </div>
        ${!t.done ? `<button class="todo-start" title="开始计时" aria-label="开始计时：${escapeHtml(t.text)}">${FloatodoIcons.markup('play')}</button>` : ''}
        <button class="todo-delete" title="移入回收站" aria-label="移入回收站">${FloatodoIcons.markup('close')}</button>
      </li>`
  })

  todoList.innerHTML = html
  bindNotesEvents()

  todoList.querySelectorAll('.todo-item').forEach(item => {
    const id = item.dataset.id
    item.querySelector('input[type="checkbox"]').addEventListener('change', () => toggle(id))
    item.querySelector('.todo-delete').addEventListener('click', () => remove(id))
    if (!item.classList.contains('done')) {
      item.querySelector('.todo-start').addEventListener('click', () => {
        const todo = todos.find(todo => todo.id === id)
        if (todo && !todo.done) window.dispatchEvent(new CustomEvent('start-todo-activity', { detail: { id: todo.id, name: todo.text } }))
      })
      item.querySelector('.todo-text').addEventListener('click', () => startEdit(id))
    }
  })

  historyBtn.style.display = ''
  clearDoneBtn.style.display = ''
  statusText.style.display = ''
  btnBack.style.display = 'none'

  const activeCount = todos.filter(t => !t.done).length
  statusText.textContent = activeCount > 0 ? `${activeCount} 项未完成` : '全部完成 ✓'
}

function formatDate(dateStr, today) {
  const [, m, d] = dateStr.split('-')
  const dateLabel = `${parseInt(m)}月${parseInt(d)}日`
  if (dateStr === today) return `${dateLabel} · 今天截止`
  const diff = Math.round((new Date(dateStr + 'T00:00:00') - new Date(today + 'T00:00:00')) / 86400000)
  if (diff < 0) return `${dateLabel} · 已逾期${Math.abs(diff)}天`
  return `${dateLabel} · ${diff}天后`
}

function setTodoMutationBusy(busy) {
  todoMutationBusy = busy
  todoList.inert = busy
  clearDoneBtn.disabled = busy
  newTodoBtn.disabled = busy
  createTodoBtn.disabled = busy
  cancelTodoBtn.disabled = busy
  todoComposer.inert = busy
  todoComposer.setAttribute('aria-busy', String(busy))
}

function closeTodoComposer() {
  todoComposer.hidden = true
  todoToolbar.hidden = false
  newTodoBtn.setAttribute('aria-expanded', 'false')
  todoComposer.reset()
  isUrgent = false
  optUrgent.classList.remove('active')
  optDeadlineLabel.classList.remove('active')
  todoCreateError.hidden = true
  todoCreateError.textContent = ''
  newTodoBtn.focus()
}

async function addTodo(text) {
  text = text.trim()
  if (!text || todoComposer.hidden || todoMutationBusy) return
  setTodoMutationBusy(true)
  createTodoBtn.textContent = '正在创建…'
  todoCreateError.hidden = true
  const todo = {
    id: crypto.randomUUID(),
    text,
    done: false,
    urgent: isUrgent,
    deadline: deadlineInput.value || null,
    notes: todoNotes.value.trim(),
    completedAt: null
  }
  try {
    const updatedTodos = [todo, ...todos]
    await window.api.saveTodos(updatedTodos)
    todos = updatedTodos
    closeTodoComposer()
    render()
  } catch (error) {
    console.error('[todo-create] Failed to save todo', { id: todo.id, error })
    todoCreateError.textContent = `创建失败：${error.message}`
    todoCreateError.hidden = false
  } finally {
    setTodoMutationBusy(false)
    createTodoBtn.textContent = '创建'
    if (todoComposer.hidden) newTodoBtn.focus()
  }
}

function notesToggle(todo) {
  return `<button class="todo-notes-toggle${todo.notes ? ' has-notes' : ''}" type="button" aria-label="${todo.notes ? '查看' : '添加'}备注：${escapeHtml(todo.text)}" aria-expanded="${expandedNotes.has(todo.id)}">备注${todo.notes ? ' ·' : ''}</button>`
}

function notesPanel(todo, editable = true) {
  const notes = typeof todo.notes === 'string' ? todo.notes : ''
  return `<div class="todo-notes-panel" ${expandedNotes.has(todo.id) ? '' : 'hidden'}>
    <p class="todo-notes${notes ? '' : ' is-empty'}">${notes ? escapeHtml(notes) : '暂无备注'}</p>
    ${editable ? '<button class="todo-notes-edit" type="button">编辑备注</button>' : ''}
  </div>`
}

function bindNotesEvents(editable = true) {
  todoList.querySelectorAll('.todo-item').forEach(item => {
    const id = item.dataset.id
    const toggle = item.querySelector('.todo-notes-toggle')
    toggle.addEventListener('click', () => {
      const panel = item.querySelector('.todo-notes-panel')
      panel.hidden = !panel.hidden
      toggle.setAttribute('aria-expanded', String(!panel.hidden))
      if (panel.hidden) expandedNotes.delete(id)
      else expandedNotes.add(id)
    })
    if (editable) item.querySelector('.todo-notes-edit').addEventListener('click', () => editNotes(id))
  })
}

function editNotes(id) {
  if (todoMutationBusy) return
  const todo = todos.find(item => item.id === id)
  if (!todo) throw new Error(`待办不存在：${id}`)
  if (editingId || editingNotesId) {
    editingId = null
    editingNotesId = null
    render()
  }
  editingNotesId = id
  expandedNotes.add(id)
  const item = [...todoList.querySelectorAll('.todo-item')].find(item => item.dataset.id === id)
  const panel = item.querySelector('.todo-notes-panel')
  panel.hidden = false
  item.querySelector('.todo-notes-toggle').setAttribute('aria-expanded', 'true')
  panel.innerHTML = `<textarea class="edit-notes" aria-label="待办备注" maxlength="2000" rows="3"></textarea>
    <div class="todo-notes-actions"><button class="cancel-notes" type="button">取消</button><button class="save-notes" type="button">保存备注</button></div>
    <p class="todo-notes-error" role="alert" hidden></p>`
  const input = panel.querySelector('.edit-notes')
  input.value = typeof todo.notes === 'string' ? todo.notes : ''
  const cancel = () => { editingNotesId = null; render() }
  panel.querySelector('.cancel-notes').addEventListener('click', cancel)
  panel.querySelector('.save-notes').addEventListener('click', () => saveNotes(id, input.value, panel))
  input.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); cancel() }
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault()
      saveNotes(id, input.value, panel)
    }
  })
  input.focus()
}

async function saveNotes(id, notes, panel) {
  if (todoMutationBusy) return
  const errorMessage = panel.querySelector('.todo-notes-error')
  const button = panel.querySelector('.save-notes')
  errorMessage.hidden = true
  setTodoMutationBusy(true)
  button.textContent = '正在保存…'
  try {
    const updated = todos.map(todo => todo.id === id ? { ...todo, notes: notes.trim() } : todo)
    await window.api.saveTodos(updated)
    todos = updated
    editingNotesId = null
    render()
  } catch (error) {
    console.error('[todo-notes] Failed to save notes', { id, error })
    errorMessage.textContent = `保存失败：${error.message}`
    errorMessage.hidden = false
  } finally {
    setTodoMutationBusy(false)
    button.textContent = '保存备注'
  }
}

function toggle(id) {
  if (todoMutationBusy) return
  const t = todos.find(t => t.id === id)
  if (t) {
    t.done = !t.done
    t.completedAt = t.done ? todayStr() : null
  }
  save()
  render()
}

async function remove(id) {
  const todo = todos.find(todo => todo.id === id)
  if (!todo || todoMutationBusy) return
  setTodoMutationBusy(true)
  try {
    const result = await window.api.todoTrashAction('trash', id)
    if (!result.ok) throw new Error(result.error)
    todos = todos.filter(todo => todo.id !== id)
    render()
  } catch (error) {
    statusText.textContent = error.message
  } finally {
    setTodoMutationBusy(false)
  }
}

window.addEventListener('todos-changed', async () => {
  try {
    todos = await window.api.loadTodos()
    render()
  } catch (error) {
    statusText.textContent = error.message
  }
})

function startEdit(id) {
  if (editingId === id) return
  if (editingId) {
    editingId = null
    render()
  }

  const t = todos.find(t => t.id === id)
  if (!t || t.done) return

  editingId = id
  const li = todoList.querySelector(`[data-id="${id}"]`)
  if (!li) return

  li.classList.add('editing')
  li.querySelector('.todo-content').innerHTML = `
    <div class="edit-row">
      <input class="edit-input" type="text" value="${escapeHtml(t.text)}" maxlength="80" />
      <button class="edit-urgent icon-btn-sm${t.urgent ? ' active' : ''}" title="紧急" aria-label="紧急">${FloatodoIcons.markup('flag')}</button>
      <label class="edit-deadline icon-btn-sm${t.deadline ? ' active' : ''}" title="截止日期">${FloatodoIcons.markup('calendar')}
        <input type="date" class="edit-deadline-input" value="${t.deadline || ''}" />
      </label>
    </div>`

  const editInput       = li.querySelector('.edit-input')
  const editUrgentBtn   = li.querySelector('.edit-urgent')
  const editDdlLabel    = li.querySelector('.edit-deadline')
  const editDdlInput    = li.querySelector('.edit-deadline-input')

  editInput.focus()
  editInput.setSelectionRange(editInput.value.length, editInput.value.length)

  let urgentState = t.urgent

  editUrgentBtn.addEventListener('click', () => {
    urgentState = !urgentState
    editUrgentBtn.classList.toggle('active', urgentState)
  })

  editDdlInput.addEventListener('change', () => {
    editDdlLabel.classList.toggle('active', !!editDdlInput.value)
  })

  const doSave = () => saveEdit(id, editInput.value, urgentState, editDdlInput.value || null)
  const doCancel = () => { editingId = null; render() }

  editInput.addEventListener('keydown', e => {
    if (e.key === 'Enter')  doSave()
    if (e.key === 'Escape') doCancel()
  })
}

function saveEdit(id, text, urgent, deadline) {
  if (todoMutationBusy) return
  text = text.trim()
  if (!text) return
  const t = todos.find(t => t.id === id)
  if (t) {
    t.text = text
    t.urgent = urgent
    t.deadline = deadline
  }
  editingId = null
  save()
  render()
}

function save() {
  window.api.saveTodos(todos)
}

// ── 事件绑定 ─────────────────────────────────
newTodoBtn.addEventListener('click', () => {
  showHistory = false
  render()
  todoComposer.hidden = false
  todoToolbar.hidden = true
  newTodoBtn.setAttribute('aria-expanded', 'true')
  todoInput.focus()
})

todoComposer.addEventListener('submit', e => {
  e.preventDefault()
  addTodo(todoInput.value)
})

cancelTodoBtn.addEventListener('click', closeTodoComposer)
todoComposer.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !todoMutationBusy) {
    e.preventDefault()
    closeTodoComposer()
  }
})

optUrgent.addEventListener('click', () => {
  isUrgent = !isUrgent
  optUrgent.classList.toggle('active', isUrgent)
})

deadlineInput.addEventListener('change', () => {
  optDeadlineLabel.classList.toggle('active', !!deadlineInput.value)
})

btnMin.addEventListener('click', () => window.api.minimize())
btnClose.addEventListener('click', () => window.api.close())
btnPin.addEventListener('click', () => {
  pinned = !pinned
  btnPin.classList.toggle('active', pinned)
  btnPin.setAttribute('aria-pressed', String(pinned))
  btnPin.title = pinned ? '取消置顶' : '固定置顶'
  window.api.setPin(pinned)
})

clearDoneBtn.addEventListener('click', () => {
  if (todoMutationBusy) return
  const done = todos.filter(t => t.done)
  if (done.length === 0) return
  const existingIds = new Set(archive.map(t => t.id))
  done.forEach(t => { if (!existingIds.has(t.id)) archive.push(t) })
  todos = todos.filter(t => !t.done)
  window.api.saveArchive(archive)
  save()
  render()
})

historyBtn.addEventListener('click', () => {
  showHistory = true
  render()
})

btnBack.addEventListener('click', () => {
  showHistory = false
  render()
})

function renderHistory() {
  document.getElementById('todoHeadingLabel').textContent = '完成记录'
  document.getElementById('todoEyebrow').textContent = 'LITTLE WINS, EVERY DAY'
  // 合并 todos 中 done 任务 + archive，按 id 去重
  const seen = new Set()
  const all = []
  ;[...todos.filter(t => t.done), ...archive].forEach(t => {
    if (!seen.has(t.id)) { seen.add(t.id); all.push(t) }
  })
  document.getElementById('todoCount').textContent = all.length

  // footer
  historyBtn.style.display = 'none'
  clearDoneBtn.style.display = 'none'
  statusText.style.display = 'none'
  btnBack.style.display = ''

  if (all.length === 0) {
    todoList.innerHTML = `<div class="empty-hint">暂无历史记录</div>`
    return
  }

  // 按月分组（YYYY-MM），降序
  const groups = new Map()
  all.forEach(t => {
    const key = (t.completedAt || '0000-00').slice(0, 7)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(t)
  })
  const sortedKeys = [...groups.keys()].sort((a, b) => b.localeCompare(a))

  let html = ''
  sortedKeys.forEach(key => {
    const [y, m] = key.split('-')
    const items = groups.get(key).sort((a, b) => (b.completedAt || '').localeCompare(a.completedAt || ''))
    html += `<li class="section-divider">${parseInt(y)}年${parseInt(m)}月（${items.length}件）</li>`
    items.forEach(t => {
      const urgentBadge = t.urgent ? `<span class="urgent-badge">急</span>` : ''
      let dateLabel = ''
      if (t.completedAt) {
        const [, cm, cd] = t.completedAt.split('-')
        dateLabel = `${parseInt(cm)}月${parseInt(cd)}日`
      }
      html += `
        <li class="todo-item done" data-id="${t.id}">
          <input type="checkbox" checked disabled />
          <div class="todo-content">
            <div class="todo-main">
              <span class="todo-text">${escapeHtml(t.text)}</span>${urgentBadge}${notesToggle(t)}
            </div>
            ${notesPanel(t, false)}
          </div>
          <span class="history-date">${dateLabel}</span>
        </li>`
    })
  })

  todoList.innerHTML = html
  bindNotesEvents(false)
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}


init()
