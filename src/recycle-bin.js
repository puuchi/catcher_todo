;(function () {
  const byId = id => document.getElementById(id)
  let entries = []
  let loadVersion = 0
  let confirmingKey = null
  const pending = new Set()

  function message(text) {
    byId('trashMessage').textContent = text || ''
    byId('trashMessage').hidden = !text
  }

  async function load() {
    const version = ++loadVersion
    try {
      const [todos,activities] = await Promise.all([window.api.loadTodoTrash(),window.api.getActivities()])
      if (version !== loadVersion) return
      if (activities.error) message(activities.error)
      entries = [
        ...todos.map(todo => ({id:todo.id,kind:'todo',deletedAt:todo.deletedAt,name:todo.text,todo})),
        ...(activities.trash || []).map(entry => ({...entry,name:entry.activity.name}))
      ].reverse().sort((a,b) => Date.parse(b.deletedAt)-Date.parse(a.deletedAt))
      render()
    } catch (error) { message(`回收站读取失败：${error.message}`) }
  }

  function key(entry) { return `${entry.kind}:${entry.id}` }

  async function perform(entry,action) {
    if (pending.has(key(entry))) return
    pending.add(key(entry))
    message('')
    render()
    try {
      const response = entry.kind === 'todo'
        ? await window.api.todoTrashAction(action,entry.id)
        : await window.api.activityCommand({type:action === 'restore' ? 'trash-restore' : 'trash-delete',payload:{id:entry.id},requestId:crypto.randomUUID()})
      if (!response.ok) throw new Error(response.error)
      confirmingKey = null
      if (entry.kind === 'todo') window.dispatchEvent(new Event('todos-changed'))
      await load()
    } catch (error) { message(error.message) }
    finally { pending.delete(key(entry)); render() }
  }

  function details(entry) {
    if (entry.kind === 'todo') return entry.todo.done ? '已完成待办' : '待办'
    if (entry.kind === 'matter') return `${ActivitySessions.sessionsOf(entry.activity).length} 次投入 · ${ActivityTime.humanDuration(ActivityTime.duration(entry.activity))}`
    const start = new Date(entry.session.startTime).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',hour12:false})
    const end = new Date(entry.session.endTime).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',hour12:false})
    return `${start}–${end} · ${ActivityTime.humanDuration(ActivityTime.duration(entry.session))}`
  }

  function render() {
    const list = byId('trashList')
    const scroll = list.scrollTop
    list.replaceChildren()
    const selected = byId('trashFilter').value
    const visible = entries.filter(entry => selected === 'all' || entry.kind === selected)
    if (!visible.length) {
      const empty = document.createElement('p')
      empty.className = 'empty-hint'
      empty.textContent = selected === 'all' ? '回收站是空的' : '暂无已删除内容'
      list.append(empty)
    }
    for (const entry of visible) {
      const row = document.createElement('article')
      row.className = 'recycle-item'
      row.dataset.trashId = entry.id
      row.dataset.kind = entry.kind
      const metadata = document.createElement('div')
      metadata.className = 'recycle-meta'
      const kind = document.createElement('span')
      kind.textContent = {todo:'待办',matter:'事项',session:'单次记录'}[entry.kind]
      const date = document.createElement('time')
      date.dateTime = entry.deletedAt
      date.textContent = new Date(entry.deletedAt).toLocaleString([],{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false})
      metadata.append(kind,date)
      const title = document.createElement('div')
      title.className = 'recycle-name'
      title.textContent = entry.name
      title.title = entry.name
      const subtitle = document.createElement('div')
      subtitle.className = 'recycle-detail'
      subtitle.textContent = entry.kind === 'session' && entry.session.progress ? `${entry.session.progress} · ${details(entry)}` : details(entry)
      subtitle.title = subtitle.textContent
      const actions = document.createElement('div')
      actions.className = 'recycle-actions'
      const restore = document.createElement('button')
      restore.className = entry.kind === 'todo' ? 'recycle-restore todo-restore' : 'recycle-restore activity-restore'
      restore.textContent = '恢复'
      restore.setAttribute('aria-label',`恢复${kind.textContent}：${entry.name}`)
      restore.disabled = pending.has(key(entry))
      restore.addEventListener('click',() => perform(entry,'restore'))
      const remove = document.createElement('button')
      remove.className = 'trash-delete'
      remove.append(FloatodoIcons.create('trash'))
      const confirming = confirmingKey === key(entry)
      remove.classList.toggle('confirming',confirming)
      remove.title = confirming ? '再次点击永久删除' : '永久删除'
      remove.setAttribute('aria-label',confirming ? '确认永久删除' : '永久删除')
      remove.disabled = pending.has(key(entry))
      remove.addEventListener('click',() => {
        if (confirmingKey !== key(entry)) { confirmingKey = key(entry); render(); return }
        perform(entry,'delete')
      })
      actions.append(restore,remove)
      row.append(metadata,title,subtitle,actions)
      list.append(row)
    }
    list.scrollTop = scroll
  }

  byId('trashFilter').addEventListener('change',() => { confirmingKey = null; render() })
  window.addEventListener('recycle-open',() => { confirmingKey = null; message(''); load() })
  window.api.onActivities(() => { if (!byId('page-trash').hidden) load() })
})()
