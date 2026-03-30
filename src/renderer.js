let todos = []
let archive = []
let pinned = true
let isUrgent = false
let editingId = null
let showHistory = false

const todoInput        = document.getElementById('todoInput')
const todoList         = document.getElementById('todoList')
const statusText       = document.getElementById('statusText')
const clearDoneBtn     = document.getElementById('clearDone')
const historyBtn       = document.getElementById('historyBtn')
const btnBack          = document.getElementById('btnBack')
const btnPin           = document.getElementById('btnPin')
const btnMin           = document.getElementById('btnMin')
const btnClose         = document.getElementById('btnClose')
const btnBubble        = document.getElementById('btnBubble')
const optUrgent        = document.getElementById('optUrgent')
const deadlineInput    = document.getElementById('deadlineInput')
const optDeadlineLabel = document.getElementById('optDeadlineLabel')

function todayStr() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' })
}

async function init() {
  todos = await window.api.loadTodos()
  archive = await window.api.loadArchive()
  render()
}

function render() {
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
    todoList.innerHTML = `<div class="empty-hint">暂无任务<br>在上方输入，按 Enter 添加</div>`
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
            <span class="todo-text">${escapeHtml(t.text)}</span>${urgentBadge}${deadlineBadge}
          </div>
        </div>
        <button class="todo-delete" title="删除">✕</button>
      </li>`
  })

  todoList.innerHTML = html

  todoList.querySelectorAll('.todo-item').forEach(item => {
    const id = item.dataset.id
    item.querySelector('input[type="checkbox"]').addEventListener('change', () => toggle(id))
    item.querySelector('.todo-delete').addEventListener('click', () => remove(id))
    if (!item.classList.contains('done')) {
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

function addTodo(text) {
  text = text.trim()
  if (!text) return
  todos.unshift({
    id: Date.now().toString(),
    text,
    done: false,
    urgent: isUrgent,
    deadline: deadlineInput.value || null,
    completedAt: null
  })
  isUrgent = false
  optUrgent.classList.remove('active')
  deadlineInput.value = ''
  optDeadlineLabel.classList.remove('active')
  save()
  render()
}

function toggle(id) {
  const t = todos.find(t => t.id === id)
  if (t) {
    t.done = !t.done
    t.completedAt = t.done ? todayStr() : null
  }
  save()
  render()
}

function remove(id) {
  todos = todos.filter(t => t.id !== id)
  save()
  render()
}

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
      <button class="edit-urgent icon-btn-sm${t.urgent ? ' active' : ''}" title="紧急">🚨</button>
      <label class="edit-deadline icon-btn-sm${t.deadline ? ' active' : ''}" title="截止日期">📅
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
todoInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    addTodo(todoInput.value)
    todoInput.value = ''
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
btnBubble.addEventListener('click', () => window.api.minimizeToBubble())
btnPin.addEventListener('click', () => {
  pinned = !pinned
  btnPin.classList.toggle('active', pinned)
  btnPin.textContent = pinned ? '▲' : '△'
  window.api.setPin(pinned)
})

clearDoneBtn.addEventListener('click', () => {
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
  // 合并 todos 中 done 任务 + archive，按 id 去重
  const seen = new Set()
  const all = []
  ;[...todos.filter(t => t.done), ...archive].forEach(t => {
    if (!seen.has(t.id)) { seen.add(t.id); all.push(t) }
  })

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
        <li class="todo-item done">
          <input type="checkbox" checked disabled />
          <div class="todo-content">
            <div class="todo-main">
              <span class="todo-text">${escapeHtml(t.text)}</span>${urgentBadge}
            </div>
          </div>
          <span class="history-date">${dateLabel}</span>
        </li>`
    })
  })

  todoList.innerHTML = html
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}


init()
