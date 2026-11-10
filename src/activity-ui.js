;(function () {
  const byId = id => document.getElementById(id)
  const { localDate, dayBounds, duration, clock, humanDuration, heatLevel, timelineEntries, matterColor, durationOpacity, untrackedGaps, sessionDays } = ActivityTime
  let state = { activities: [] }
  let busy = false
  let page = 'todos'
  let editing = null
  let editorScope = 'new'
  let editingSessionId = null
  let editorEndDayOffset = 0
  let editorEndDayExplicit = false
  let focusedActivityId = null
  let detailActivityId = null
  let detailAnchor = null
  let progressSessionId = null
  const dismissedNotices = new Set()
  let visibleNotice = null
  let deleteId = null
  let firstLoad = true
  let trashReturnPage = 'todos'
  let pendingMatterDelete = null
  let timelineRenderDay = localDate()
  const editor = byId('activityEditor')
  const menu = byId('timelineMenu')
  const menuEdit = byId('timelineMenuEdit')
  const menuDelete = byId('timelineMenuDelete')
  let menuActivityId = null
  let menuTrigger = null
  let editorReturnActivityId = null
  let editorReturnEntryKey = null
  let menuEntryKey = null
  let menuAnchorTop = 0
  const dateInput = byId('timelineDate')
  dateInput.value = localDate()
  byId('deleteMatter').append(FloatodoIcons.create('trash'))
  byId('deleteSelectedMatter').append(FloatodoIcons.create('trash'))
  byId('clearFocus').replaceChildren(FloatodoIcons.create('close'))

  function current() { return state.activities.find(activity => activity.status === 'running') }

  function paused() { return state.activities.filter(activity => activity.status === 'paused') }

  const actionButtons = '#startActivityForm button, #pauseActivity, #endActivity, #saveActivity, .todo-start, .background-actions button'

  function message(text, { notice = false } = {}) {
    const hidden = !text || notice && dismissedNotices.has(text)
    visibleNotice = notice && !hidden ? text : null
    byId('activityMessageText').textContent = hidden ? '' : text
    byId('activityMessage').hidden = hidden
    byId('dismissActivityMessage').hidden = !visibleNotice
  }

  byId('dismissActivityMessage').addEventListener('click', () => {
    if (!visibleNotice) return
    dismissedNotices.add(visibleNotice)
    message('')
    document.querySelector('[data-page].selected')?.focus({preventScroll:true})
  })

  function selectPage(next) {
    closeMenu(false)
    deleteId = null
    page = next
    document.querySelectorAll('.module-page').forEach(element => { element.hidden = element.id !== `page-${next}` })
    document.querySelectorAll('[data-page]').forEach(button => {
      button.classList.toggle('selected', button.dataset.page === next)
      button.setAttribute('aria-selected', String(button.dataset.page === next))
    })
    byId('todoTrashBtn').setAttribute('aria-pressed',String(next === 'trash'))
    if (next === 'timeline') { renderTimeline(); if (detailActivityId) renderDetails() }
  }

  function setState(next) {
    if ((next.revision || 0) < (state.revision || 0)) return
    state = next
    message(state.error || state.notice, { notice: !state.error && Boolean(state.notice) })
    if (firstLoad && (current() || paused().length)) selectPage('current')
    firstLoad = false
    renderCurrent()
    if (page === 'timeline') { renderTimeline(); if (detailActivityId) renderDetails() }
  }

  async function command(type, payload = {}) {
    if (busy) return false
    busy = true
    document.querySelectorAll(actionButtons).forEach(button => { button.disabled = true })
    try {
      const response = await window.api.activityCommand({ type, payload, requestId: crypto.randomUUID() })
      if (response.state) setState(response.state)
      if (!response.ok) throw new Error(response.error)
      return true
    } catch (error) {
      message(error.message)
      if (editor.open) {
        byId('editorError').textContent = error.message
        byId('editorError').scrollIntoView({ block: 'nearest' })
      }
      return false
    } finally {
      busy = false
      document.querySelectorAll(actionButtons).forEach(button => { button.disabled = Boolean(state.error) })
    }
  }

  const pauseHints = {
    lock: '锁屏时已自动暂停。',
    sleep: '睡眠前已自动暂停。',
    interrupted: '上次意外中断，已暂停到最近检查点。可在时间轴中修正。',
    'clock-gap': '检测到系统时间变化或运行中断，已暂停到最近检查点，请核对时间。',
    'save-error': '保存遇到问题，已暂停，请检查磁盘空间。', shutdown: '系统关闭时已暂停，请确认后继续。'
  }

  function renderCurrent() {
    const activity = current()
    const background = paused()
    const session = activity && ActivitySessions.sessionsOf(activity).find(session => session.endTime === null)
    byId('currentName').textContent = activity?.name || '暂无前台事项'
    byId('currentName').title = activity?.name || ''
    byId('currentStatus').textContent = activity ? '计时中' : '未在计时'
    byId('currentStatus').className = activity?.status || ''
    byId('navActivityDot').className = activity ? 'running' : background.length ? 'paused' : ''
    byId('currentStarted').textContent = session ? `${new Date(session.startTime).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})} 开始` : ''
    byId('currentTimer').textContent = activity ? clock(duration(activity)) : '00:00:00'
    byId('currentHint').hidden = true
    byId('progressForm').hidden = !session
    const progressInput = byId('currentProgress')
    if (progressSessionId !== session?.id || document.activeElement !== progressInput) progressInput.value = session?.progress || ''
    progressSessionId = session?.id || null
    byId('pauseActivity').hidden = !activity
    byId('endActivity').hidden = !activity
    byId('pauseActivity').textContent = '暂停'
    byId('backgroundActivities').hidden = !background.length
    byId('backgroundCount').textContent = `(${background.length})`
    const list = byId('pausedActivityList')
    list.replaceChildren()
    for (const item of background.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))) {
      const row = document.createElement('div')
      row.className = 'background-item'
      row.dataset.activityId = item.id
      const content = document.createElement('div')
      content.className = 'background-content'
      const name = document.createElement('div')
      name.className = 'background-name'
      name.textContent = item.name
      name.title = item.name
      const total = document.createElement('div')
      total.className = 'background-duration'
      total.textContent = `累计 ${humanDuration(duration(item))}`
      if (pauseHints[item.pauseReason]) total.title = pauseHints[item.pauseReason]
      content.append(name, total)
      const actions = document.createElement('div')
      actions.className = 'background-actions'
      const resume = document.createElement('button')
      resume.className = 'background-resume'
      resume.textContent = '继续'
      resume.setAttribute('aria-label', `继续：${item.name}`)
      resume.addEventListener('click', () => command('resume', {id:item.id}))
      const end = document.createElement('button')
      end.className = 'background-end'
      end.textContent = '结束'
      end.setAttribute('aria-label', `结束：${item.name}`)
      end.addEventListener('click', () => command('end', {id:item.id}))
      actions.append(resume, end)
      row.append(content, actions)
      list.append(row)
    }
    document.querySelectorAll(actionButtons).forEach(button => { button.disabled = busy || Boolean(state.error) })
  }

  function timeLabel(time, selectedDay) {
    const date = new Date(time)
    const timeText = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
    return localDate(date) === selectedDay ? timeText : `${date.getMonth() + 1}/${date.getDate()} ${timeText}`
  }

  function paintStrip(row, activity, milliseconds) {
    row.dataset.heat = heatLevel(milliseconds)
    row.style.setProperty('--matter-rgb', matterColor(activity.id,activity.color).rgb)
    row.style.setProperty('--visit-opacity', durationOpacity(milliseconds))
  }

  function applyFocus() {
    const visits = timelineEntries(state.activities.filter(item => item.id === focusedActivityId),dateInput.value)
    if (!visits.length) focusedActivityId = null
    const rows = [...byId('timelineList').querySelectorAll('.timeline-item')]
    for (const row of rows) {
      const selected = row.dataset.activityId === focusedActivityId
      row.classList.toggle('is-focused', Boolean(focusedActivityId) && selected)
      row.classList.toggle('is-dimmed', Boolean(focusedActivityId) && !selected)
      row.setAttribute('aria-pressed', String(Boolean(focusedActivityId) && selected))
    }
    const matter = state.activities.find(item => item.id === focusedActivityId)
    byId('focusSummary').hidden = !matter
    if (matter) {
      byId('focusSummaryText').textContent = matter.name
      byId('focusSummaryText').title = matter.name
      byId('focusSummaryStats').textContent = `当日 ${visits.length} 次投入 · 累计 ${humanDuration(duration(matter,Date.now(),dayBounds(dateInput.value)))}`
      byId('focusSummary').style.setProperty('--focus-color',matterColor(matter.id,matter.color).hex)
    }
  }

  function toggleFocus(id) {
    focusedActivityId = focusedActivityId === id ? null : id
    applyFocus()
  }

  function gapRow(gap) {
    const row = document.createElement('div')
    row.className = 'timeline-gap'
    row.dataset.trailing = String(Boolean(gap.trailing))
    row.dataset.startTime = gap.startTime
    const text = document.createElement('span')
    text.textContent = `未计时  ${timeLabel(gap.startTime,dateInput.value)}–${timeLabel(gap.endTime,dateInput.value)}`
    const total = document.createElement('span')
    total.className = 'gap-duration'
    total.textContent = humanDuration(Date.parse(gap.endTime)-Date.parse(gap.startTime))
    const actions = document.createElement('span')
    actions.className = 'gap-actions'
    const add = document.createElement('button')
    add.type = 'button'
    add.className = 'gap-add'
    add.append(FloatodoIcons.create('plus'))
    add.title = '补录这段未计时时间'
    add.setAttribute('aria-label','补录未计时区间')
    add.addEventListener('click',() => openEditor(null,null,'new',gap))
    actions.append(total,add)
    row.append(text,actions)
    return row
  }

  function renderTimeline() {
    if (!dateInput.value) return
    timelineRenderDay = localDate()
    const bounds = dayBounds(dateInput.value)
    const now = Date.now()
    const entries = timelineEntries(state.activities,dateInput.value,now)
    updateDayTotal(bounds,now)
    const list = byId('timelineList')
    list.replaceChildren()
    if (!entries.length) {
      closeMenu(false)
      const empty = document.createElement('p')
      empty.className = 'empty-hint'
      empty.textContent = '暂无记录'
      list.append(empty)
    }
    const direction = dateInput.value === localDate() ? -1 : 1
    const logs = [...entries,...untrackedGaps(state.activities,dateInput.value,now)]
      .sort((a,b) => direction * (Date.parse(a.startTime)-Date.parse(b.startTime)))
    for (const activity of logs) {
      if (activity.gap) { list.append(gapRow(activity)); continue }
      const row = document.createElement('article')
      row.className = `timeline-item ${activity.status}`
      row.dataset.activityId = activity.id
      row.dataset.entryKey = activity.entryKey
      row.dataset.startTime = activity.startTime
      row.tabIndex = 0
      row.setAttribute('role','button')
      row.setAttribute('aria-label',`${activity.name}，聚焦事项`)
      paintStrip(row,activity,duration(activity,now))
      const range = document.createElement('div')
      range.className = 'timeline-range'
      range.textContent = `${timeLabel(activity.startTime,dateInput.value)}–${activity.endTime ? timeLabel(activity.endTime,dateInput.value) : '现在'}`
      const title = document.createElement('div')
      title.className = 'timeline-name'
      title.title = activity.name
      const name = document.createElement('span')
      name.className = 'timeline-title'
      name.textContent = activity.name
      if (activity.sessionIndex > 0) {
        const mark = document.createElement('span')
        mark.className = 'timeline-return-mark'
        mark.title = '再次投入'
        mark.setAttribute('aria-label','再次投入')
        mark.append(FloatodoIcons.create('return'))
        title.append(mark)
      }
      title.append(name)
      const total = document.createElement('div')
      total.className = 'muted timeline-duration'
      total.title = '当日有效时长'
      total.textContent = humanDuration(duration(activity,now,bounds))
      const heading = document.createElement('div')
      heading.className = 'timeline-heading'
      heading.append(title,total)
      const metadata = document.createElement('div')
      metadata.className = 'timeline-meta'
      metadata.append(range)
      if (activity.progress) {
        const progress = document.createElement('span')
        progress.className = 'timeline-progress'
        progress.textContent = activity.progress
        progress.title = progress.textContent
        metadata.append(progress)
      }
      if (activity.status !== 'completed') {
        const status = document.createElement('span')
        status.className = `timeline-status ${activity.status}`
        status.textContent = activity.status === 'running' ? '进行中' : '已暂停'
        metadata.append(status)
      }
      const toggle = document.createElement('button')
      toggle.className = 'timeline-menu-toggle'
      toggle.textContent = '···'
      toggle.title = '活动操作'
      toggle.setAttribute('aria-label',`活动操作：${activity.name}`)
      toggle.setAttribute('aria-haspopup','menu')
      toggle.setAttribute('aria-expanded','false')
      toggle.setAttribute('aria-controls','timelineMenu')
      toggle.addEventListener('click',event => {
        event.stopPropagation()
        if (menuEntryKey === activity.entryKey) closeMenu(true)
        else showMenu(activity.id,activity.entryKey,toggle)
      })
      toggle.addEventListener('keydown',event => {
        event.stopPropagation()
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault()
          showMenu(activity.id,activity.entryKey,toggle,event.key === 'ArrowUp')
        }
      })
      row.addEventListener('click',() => toggleFocus(activity.id))
      row.addEventListener('keydown',event => {
        if (event.target !== row) return
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggleFocus(activity.id) }
      })
      row.append(heading,metadata,toggle)
      list.append(row)
    }
    applyFocus()
    if (menuActivityId) {
      menuTrigger = findMenuTrigger(menuActivityId,menuEntryKey)
      if (menuTrigger) { menuTrigger.setAttribute('aria-expanded','true'); positionMenu() }
      else closeMenu(false)
    }
  }

  function renderDetails(locate = false) {
    const matter = state.activities.find(item => item.id === detailActivityId)
    if (!matter) { showOverview(); return }
    byId('matterName').textContent = matter.name
    byId('matterName').style.setProperty('--matter-color',matterColor(matter.id,matter.color).hex)
    byId('matterStatus').textContent = {running:'进行中',paused:'已暂停',completed:'已完成'}[matter.status]
    byId('matterStatus').className = `timeline-status ${matter.status}`
    byId('matterTotal').textContent = humanDuration(duration(matter))
    byId('matterVisits').textContent = `${ActivitySessions.sessionsOf(matter).length} 次`
    const list = byId('matterSessions')
    const scrollTop = byId('matterDetailBody').scrollTop
    list.replaceChildren()
    for (const day of sessionDays(matter)) {
      const group = document.createElement('section')
      group.className = 'detail-day'
      const label = document.createElement('h3')
      label.textContent = day.replace(/-/g,' / ')
      group.append(label)
      const entries = timelineEntries([matter],day).sort((a,b)=>Date.parse(a.startTime)-Date.parse(b.startTime))
      for (const entry of entries) {
        const row = document.createElement('article')
        row.className = 'detail-session'
        row.dataset.sessionId = entry.sessionId
        row.dataset.day = day
        paintStrip(row,matter,duration(entry))
        const title = document.createElement('strong')
        title.textContent = `${entry.sessionIndex > 0 ? '↩ ' : ''}${entry.progress || matter.name}`
        title.title = entry.progress || matter.name
        const metadata = document.createElement('div')
        metadata.className = 'detail-session-meta'
        metadata.textContent = `${timeLabel(entry.startTime,day)}–${entry.endTime ? timeLabel(entry.endTime,day) : '现在'} · ${humanDuration(duration(entry,Date.now(),dayBounds(day)))}`
        const edit = document.createElement('button')
        edit.className = 'session-edit'
        edit.textContent = '✎'
        edit.title = '编辑本次进展与时间'
        edit.setAttribute('aria-label','编辑本次记录')
        edit.addEventListener('click',async()=>{
          const session = ActivitySessions.sessionsOf(matter).find(item=>item.id===entry.sessionId)
          if (session.endTime === null && !await command('pause')) return
          openEditor(state.activities.find(item=>item.id===matter.id),entry.sessionId,'session')
        })
        const actions = document.createElement('div')
        actions.className = 'detail-session-actions'
        actions.append(edit)
        row.append(title,metadata,actions)
        group.append(row)
      }
      list.append(group)
    }
    byId('matterDetailBody').scrollTop = scrollTop
    if (detailAnchor) {
      const target = [...list.querySelectorAll('.detail-session')].find(row=>row.dataset.sessionId===detailAnchor && row.dataset.day===dateInput.value)
      target?.classList.add('detail-origin')
      if (locate) target?.scrollIntoView({block:'nearest'})
    }
  }

  function showDetails(id,sessionId) {
    resetMatterDelete()
    detailActivityId = id
    detailAnchor = sessionId
    byId('timelineOverview').hidden = true
    byId('matterDetails').hidden = false
    renderDetails(true)
    byId('backToTimeline').focus({preventScroll:true})
  }

  function showOverview() {
    detailActivityId = null
    byId('matterDetails').hidden = true
    byId('timelineOverview').hidden = false
    renderTimeline()
  }

  function findMenuTrigger(id, entryKey) {
    const rows = [...byId('timelineList').children]
    const row = rows.find(row => entryKey && row.dataset.entryKey === entryKey) || rows.find(row => row.dataset.activityId === id)
    return row?.querySelector('.timeline-menu-toggle')
  }

  function updateGaps(now) {
    const list = byId('timelineList')
    list.querySelectorAll('.timeline-gap').forEach(row => row.remove())
    const direction = dateInput.value === localDate() ? -1 : 1
    for (const gap of untrackedGaps(state.activities,dateInput.value,now)) {
      const next = [...list.children].find(row => row.dataset.startTime &&
        direction * (Date.parse(row.dataset.startTime) - Date.parse(gap.startTime)) > 0)
      list.insertBefore(gapRow(gap),next || null)
    }
  }

  function closeMenu(restoreFocus) {
    const trigger = menuTrigger
    trigger?.setAttribute('aria-expanded', 'false')
    menu.hidden = true
    menuActivityId = null
    menuEntryKey = null
    menuTrigger = null
    deleteId = null
    menuDelete.setAttribute('aria-label','删除本次记录')
    menuDelete.title = '删除本次记录'
    menuDelete.classList.remove('danger')
    if (restoreFocus && trigger?.isConnected) trigger.focus()
  }

  function positionMenu() {
    const bounds = menuTrigger.getBoundingClientRect()
    menuAnchorTop = bounds.top
    menu.style.left = `${Math.max(8, Math.min(bounds.right - menu.offsetWidth, innerWidth - menu.offsetWidth - 8))}px`
    menu.style.top = `${Math.max(8, Math.min(bounds.bottom + 3, innerHeight - menu.offsetHeight - 8))}px`
  }

  function showMenu(id, entryKey, trigger, focusLast = false) {
    closeMenu(false)
    menuActivityId = id
    menuEntryKey = entryKey
    menuTrigger = trigger
    trigger.setAttribute('aria-expanded', 'true')
    menu.hidden = false
    positionMenu()
    menuEdit.textContent = '↗ 详情'
    menuEdit.title = '查看事项全部记录'
    ;(focusLast ? menuDelete : menuEdit).focus({preventScroll:true})
  }

  menu.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); closeMenu(true); return }
    if (event.key === 'Tab') { closeMenu(true); return }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault()
      const items = [menuEdit, menuDelete]
      const index = items.indexOf(document.activeElement)
      let next = (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
      if (event.key === 'Home') next = 0
      if (event.key === 'End') next = 1
      items[next].focus({preventScroll:true})
    }
  })
  document.addEventListener('pointerdown', event => {
    if (!menu.hidden && !menu.contains(event.target) && !menuTrigger?.contains(event.target)) closeMenu(false)
  })
  document.addEventListener('focusin', event => {
    if (!menu.hidden && !menu.contains(event.target) && event.target !== menuTrigger) closeMenu(false)
  })
  byId('timelineList').addEventListener('scroll', () => {
    if (!menu.hidden && menuTrigger && Math.abs(menuTrigger.getBoundingClientRect().top - menuAnchorTop) > .5) closeMenu(false)
  })
  window.addEventListener('resize', () => closeMenu(false))
  menuEdit.addEventListener('click', () => {
    const id = menuActivityId
    const entryKey = menuEntryKey
    closeMenu(false)
    showDetails(id,entryKey)
  })
  menuDelete.addEventListener('click',async()=>{
    const id = menuActivityId
    const sessionId = menuEntryKey
    if (!id) return
    if (deleteId !== sessionId) {
      deleteId = sessionId
      menuDelete.setAttribute('aria-label','确认删除本次记录')
      menuDelete.title = '再次点击确认删除本次记录'
      menuDelete.classList.add('danger')
      return
    }
    const rows = [...byId('timelineList').querySelectorAll('.timeline-item')]
    const index = rows.findIndex(row => row.dataset.entryKey === sessionId)
    const neighbor = rows[index + 1] || rows[index - 1]
    const neighborId = neighbor?.dataset.activityId
    const neighborKey = neighbor?.dataset.entryKey
    closeMenu(false)
    const removed = await command('session-delete',{activityId:id,sessionId})
    const target = removed ? findMenuTrigger(neighborId,neighborKey) : findMenuTrigger(id,sessionId)
    ;(target || byId('addActivity')).focus({preventScroll:true})
  })
  byId('clearFocus').addEventListener('click',()=>{ focusedActivityId=null; applyFocus() })
  byId('timelineOverview').addEventListener('click',event=>{
    if (!event.target.closest('.timeline-item, button, input')) { focusedActivityId=null; applyFocus() }
  })
  byId('backToTimeline').addEventListener('click',()=>{
    const id = detailActivityId
    showOverview()
    findMenuTrigger(id,detailAnchor)?.focus()
  })
  byId('editMatter').addEventListener('click',()=>openEditor(state.activities.find(item=>item.id===detailActivityId),null,'matter'))
  byId('deleteMatter').addEventListener('click',() => trashMatter(detailActivityId,byId('deleteMatter')))
  byId('deleteSelectedMatter').addEventListener('click',() => trashMatter(byId('recordActivity').value,byId('deleteSelectedMatter')))
  byId('todoTrashBtn').addEventListener('click',() => {
    if (page === 'trash') { selectPage(trashReturnPage); return }
    trashReturnPage = page
    selectPage('trash')
    window.dispatchEvent(new Event('recycle-open'))
  })
  byId('trashBack').addEventListener('click',() => selectPage(trashReturnPage))
  byId('progressForm').addEventListener('submit',async event=>{
    event.preventDefault()
    const activity = current()
    const sessionId = progressSessionId
    if (!activity || !sessionId) return
    try {
      // Capture the visit before awaiting IPC so a concurrent switch cannot move this note.
      const response = await window.api.activityCommand({
        type: 'progress',
        payload: { activityId: activity.id, sessionId, progress: byId('currentProgress').value },
        requestId: crypto.randomUUID()
      })
      if (response.state) setState(response.state)
      message(response.ok ? '' : response.error)
    } catch (error) {
      message(`本次进展保存失败：${error.message}`)
    }
  })

  function updateDayTotal(bounds, now) {
    const total = state.activities.reduce((sum, activity) => sum + duration(activity, now, bounds), 0)
    const prefix = dateInput.value === localDate() ? '今日已记录' : '当日已记录'
    byId('dayTotal').textContent = `${prefix} ${humanDuration(total)}`
  }

  function localInput(value) {
    const date = new Date(value)
    return `${localDate(date)}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`
  }

  function inputTime(input) {
    let value = input.value.trim().replace(' ', 'T')
    if (input.id === 'editActivityStart' || input.id === 'editActivityEnd') {
      const day = input.id === 'editActivityEnd' ? editorEndDate() : byId('editActivityDate').value
      value = `${day}T${value}`
    }
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) value += ':00'
    if (input.dataset.originalTime && value === localInput(input.dataset.originalTime)) return input.dataset.originalTime
    const date = new Date(value)
    if (!Number.isFinite(+date) || localInput(date) !== value) throw new Error('请填写有效的日期与时间')
    return date.toISOString()
  }

  function editorSegments() {
    if (editorScope === 'new') return [{start:inputTime(byId('editActivityStart')),end:inputTime(byId('editActivityEnd'))}]
    return ActivitySessions.resizeSessionSegments(editing,
      inputTime(byId('editActivityStart')),inputTime(byId('editActivityEnd')))
  }

  function updateEditorDuration() {
    const startText = byId('editActivityStart').value
    const endText = byId('editActivityEnd').value
    const timePattern = /^\d{2}:\d{2}(:\d{2})?$/
    if (!editorEndDayExplicit && timePattern.test(startText) && timePattern.test(endText)) {
      editorEndDayOffset = startText.padEnd(8,':00') > endText.padEnd(8,':00') ? 1 : 0
      updateEndDay()
    }
    try {
      const start = Date.parse(inputTime(byId('editActivityStart')))
      const end = byId('editActivityEnd').value ? Date.parse(inputTime(byId('editActivityEnd'))) : Infinity
      if (end < start) throw new Error('Invalid bounds')
      const segments = editorSegments()
      let previousEnd = start
      let total = 0
      for (const segment of segments) {
        const from = Date.parse(segment.start)
        const to = Date.parse(segment.end)
        if (from < previousEnd || to < from || to > end) throw new Error('Invalid segment')
        total += to - from
        previousEnd = to
      }
      byId('editActivityDuration').textContent = humanDuration(total)
    } catch {
      byId('editActivityDuration').textContent = '—'
    }
  }

  function useNow(input) {
    if (input.id === 'editActivityStart' || input.id === 'editActivityEnd') setEditorTime(input,new Date())
    else input.value = localInput(Date.now())
    delete input.dataset.originalTime
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
    input.focus()
  }

  function editorEndDate() {
    const date = new Date(`${byId('editActivityDate').value}T12:00:00`)
    date.setDate(date.getDate()+editorEndDayOffset)
    return localDate(date)
  }

  function updateEndDay() {
    byId('endDayToggle').textContent = editorEndDayOffset === 0 ? '当天' : editorEndDayOffset === 1 ? '次日' : `${editorEndDayOffset > 0 ? '+' : ''}${editorEndDayOffset}天`
    byId('endDayToggle').title = `结束日期 ${editorEndDate()}，点击切换当天／次日`
  }

  function setEditorTime(input,date) {
    const day = localDate(date)
    if (input.id === 'editActivityStart') byId('editActivityDate').value = day
    else {
      editorEndDayOffset = Math.round((Date.parse(`${day}T00:00:00Z`)-Date.parse(`${byId('editActivityDate').value}T00:00:00Z`))/86400000)
      editorEndDayExplicit = true
    }
    input.value = localInput(date).split('T')[1]
    updateEndDay()
  }

  const timePicker = byId('compactTimePicker')
  const pickerParts = ['pickerYear','pickerMonth','pickerDay','pickerHour','pickerMinute','pickerSecond'].map(byId)
  let pickerInput = null
  let pickerTrigger = null

  function closeTimePicker(restoreFocus = false) {
    timePicker.hidden = true
    pickerParts.forEach(input => { input.disabled = true })
    pickerTrigger?.setAttribute('aria-expanded','false')
    if (restoreFocus) pickerTrigger?.focus({preventScroll:true})
    pickerInput = null
    pickerTrigger = null
  }

  function showTimePicker(input, trigger) {
    if (pickerInput === input && !timePicker.hidden) { closeTimePicker(true); return }
    closeTimePicker()
    pickerInput = input
    pickerTrigger = trigger
    let date
    try { date = new Date(inputTime(input)) } catch { date = new Date() }
    const values = [date.getFullYear(),date.getMonth()+1,date.getDate(),date.getHours(),date.getMinutes(),date.getSeconds()]
    pickerParts.forEach((part,index) => { part.disabled = false; part.value = values[index] })
    byId('compactTimeTitle').textContent = input.id === 'editActivityStart' ? '开始时间' : '结束时间'
    byId('compactTimeError').textContent = ''
    trigger.setAttribute('aria-expanded','true')
    timePicker.hidden = false
    const anchor = input.getBoundingClientRect()
    const bounds = timePicker.getBoundingClientRect()
    timePicker.style.left = `${Math.max(8,Math.min(anchor.left,innerWidth-bounds.width-8))}px`
    const top = anchor.bottom+bounds.height+4 <= innerHeight-8 ? anchor.bottom+4 : anchor.top-bounds.height-4
    timePicker.style.top = `${Math.max(8,Math.min(top,innerHeight-bounds.height-8))}px`
    pickerParts[0].focus({preventScroll:true})
  }

  function applyTimePicker() {
    if (!pickerInput) return
    const values = pickerParts.map(input => input.value)
    if (pickerParts.some(input => !input.value || !input.checkValidity() || !Number.isInteger(Number(input.value)))) {
      byId('compactTimeError').textContent = '请填写有效的日期与时间'
      return
    }
    const [year,month,day,hour,minute,second] = values.map((value,index) => value.padStart(index === 0 ? 4 : 2,'0'))
    const value = `${year}-${month}-${day}T${hour}:${minute}:${second}`
    const date = new Date(value)
    if (!Number.isFinite(+date) || localInput(date) !== value) {
      byId('compactTimeError').textContent = '请填写有效的日期与时间'
      return
    }
    const input = pickerInput
    setEditorTime(input,date)
    // Preserve the original timestamp when the displayed second was left unchanged.
    input.dispatchEvent(new Event('input',{bubbles:true}))
    input.dispatchEvent(new Event('change',{bubbles:true}))
    closeTimePicker()
    input.focus({preventScroll:true})
  }

  byId('chooseSessionStart').addEventListener('click',() => showTimePicker(byId('editActivityStart'),byId('chooseSessionStart')))
  byId('chooseSessionEnd').addEventListener('click',() => showTimePicker(byId('editActivityEnd'),byId('chooseSessionEnd')))
  byId('sessionStartNow').addEventListener('click',() => useNow(byId('editActivityStart')))
  byId('sessionEndNow').addEventListener('click',() => useNow(byId('editActivityEnd')))
  byId('applyCompactTime').addEventListener('click',applyTimePicker)
  byId('cancelCompactTime').addEventListener('click',() => closeTimePicker(true))
  document.addEventListener('pointerdown',event => {
    if (!timePicker.hidden && !timePicker.contains(event.target) && !pickerTrigger?.contains(event.target)) closeTimePicker()
  })
  editor.addEventListener('keydown',event => {
    if (timePicker.hidden) return
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeTimePicker(true) }
    if (event.key === 'Enter' && timePicker.contains(event.target) && event.target.tagName === 'INPUT') {
      event.preventDefault()
      applyTimePicker()
    }
  })
  byId('editorBody').addEventListener('scroll',() => closeTimePicker())
  window.addEventListener('resize',() => closeTimePicker())

  function updateMatterSelection() {
    const creating = editorScope === 'new' && !byId('recordActivity').value
    const name = byId('editActivityName')
    name.closest('.editor-field').hidden = !creating && editorScope !== 'matter'
    name.disabled = !creating && editorScope !== 'matter'
    name.required = creating || editorScope === 'matter'
    byId('deleteSelectedMatter').hidden = editorScope !== 'new' || !byId('recordActivity').value
    resetMatterDelete()
  }

  function resetMatterDelete() {
    pendingMatterDelete = null
    for (const id of ['deleteMatter','deleteSelectedMatter']) {
      byId(id).classList.remove('danger')
      byId(id).title = '将整个事项及其记录移入回收站'
    }
  }

  async function trashMatter(id,button) {
    if (!id) return
    if (pendingMatterDelete !== id) {
      resetMatterDelete()
      pendingMatterDelete = id
      button.classList.add('danger')
      button.title = '再次点击，将整个事项及其记录移入回收站'
      return
    }
    if (await command('remove',{id})) {
      resetMatterDelete()
      if (editor.open) editor.close()
      if (detailActivityId === id) showOverview()
    }
  }

  function openEditor(activity = null, entryKey = null, scope = 'new', gap = null) {
    closeMenu(false)
    closeTimePicker()
    editorReturnActivityId = activity?.id || null
    editorReturnEntryKey = entryKey
    editorScope = scope
    editingSessionId = scope === 'session' ? entryKey : null
    const session = editingSessionId && ActivitySessions.sessionsOf(activity).find(item => item.id === entryKey)
    editing = session ? {...activity,...session,status:'completed'} : activity
    const source = editing
    const selector = byId('recordActivity')
    selector.replaceChildren(new Option('＋ 新建事项',''))
    for (const matter of state.activities) {
      const status = {running:'进行中',paused:'已暂停',completed:'已完成'}[matter.status]
      const duplicateName = state.activities.some(other => other.id !== matter.id && other.name === matter.name)
      selector.append(new Option(`${matter.name} · ${status}${duplicateName ? ` · ${matter.id.slice(-6)}` : ''}`,matter.id))
    }
    selector.value = ''
    byId('recordMatterField').hidden = scope !== 'new'
    byId('editActivityName').readOnly = scope === 'session'
    byId('editActivityName').value = activity?.name || ''
    updateMatterSelection()
    byId('editMatterStatusField').hidden = scope !== 'matter'
    byId('editMatterStatus').value = activity?.status || 'completed'
    byId('editProgressField').hidden = scope === 'matter'
    byId('editSessionProgress').value = session?.progress || ''
    byId('recordDateField').hidden = scope === 'matter'
    byId('editActivityDate').disabled = scope === 'matter'
    for (const id of ['editActivityStart','editActivityEnd']) {
      const input = byId(id)
      input.closest('.editor-field').hidden = scope === 'matter'
      input.disabled = scope === 'matter'
      input.pattern = '[0-9]{2}:[0-9]{2}(:[0-9]{2})?'
    }
    document.querySelectorAll('.session-time-actions').forEach(element => { element.hidden = scope === 'matter' })
    byId('editActivityDuration').parentElement.hidden = scope === 'matter'
    const now = Date.now()
    let start = +new Date(`${dateInput.value}T09:00:00`)
    let end = start+3600000
    if (dateInput.value === localDate() && end > now) {
      end = now
      start = Math.max(dayBounds(dateInput.value)[0],now-3600000)
    }
    start = gap?.startTime || source?.startTime || start
    end = gap?.endTime || source?.endTime || end
    byId('editorTitle').textContent = scope === 'matter' ? '编辑事项' : scope === 'session' ? `编辑本次 · ${activity.name}` : '补录活动'
    byId('editorTitle').title = byId('editorTitle').textContent
    byId('editActivityDate').value = localDate(new Date(start))
    editorEndDayOffset = Math.round((Date.parse(`${localDate(new Date(end))}T00:00:00Z`)-Date.parse(`${byId('editActivityDate').value}T00:00:00Z`))/86400000)
    editorEndDayExplicit = Boolean(source || gap)
    byId('editActivityStart').value = localInput(start).split('T')[1]
    byId('editActivityEnd').value = activity && !source.endTime ? '' : localInput(end).split('T')[1]
    byId('editActivityStart').dataset.originalTime = source?.startTime || gap?.startTime || ''
    byId('editActivityEnd').dataset.originalTime = source?.endTime || gap?.endTime || ''
    byId('editActivityEnd').required = scope !== 'matter'
    updateEndDay()
    byId('editorError').textContent = ''
    updateEditorDuration()
    editor.showModal()
    byId('editorBody').scrollTop = 0
  }

  document.querySelectorAll('[data-page]').forEach(button => button.addEventListener('click', () => selectPage(button.dataset.page)))
  window.addEventListener('start-todo-activity', async event => {
    const { id, name } = event.detail
    const linked = state.activities.filter(activity => activity.todoId === id && activity.status !== 'completed')
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    const activity = linked.find(activity => activity.status === 'running') || linked[0]
    if (activity) {
      if (activity.status === 'running' || await command('resume', {id:activity.id})) selectPage('current')
      return
    }
    if (await command('start', { name, todoId: id })) selectPage('current')
  })
  byId('startActivityForm').addEventListener('submit', async event => {
    event.preventDefault()
    const name = byId('activityName').value.trim()
    if (name && await command('start', {name})) { byId('activityName').value = ''; byId('activityName').focus() }
  })
  byId('pauseActivity').addEventListener('click', () => command('pause'))
  byId('endActivity').addEventListener('click', () => { if (current()) command('end', {id:current().id}) })
  byId('backgroundToggle').addEventListener('click', () => {
    const expanded = byId('backgroundToggle').getAttribute('aria-expanded') === 'true'
    byId('backgroundToggle').setAttribute('aria-expanded', String(!expanded))
    byId('pausedActivityList').hidden = expanded
    byId('backgroundActivities').classList.toggle('collapsed', expanded)
  })
  byId('quitApp').addEventListener('click', () => window.api.quit())
  byId('openToday').addEventListener('click', () => { dateInput.value = localDate(); showOverview(); selectPage('timeline') })
  dateInput.addEventListener('change', () => { closeMenu(false); renderTimeline() })
  function moveDay(offset) {
    closeMenu(false)
    const date = new Date(`${dateInput.value || localDate()}T12:00:00`)
    date.setDate(date.getDate() + offset)
    dateInput.value = localDate(date)
    deleteId = null
    renderTimeline()
  }
  byId('previousDay').addEventListener('click', () => moveDay(-1))
  byId('nextDay').addEventListener('click', () => moveDay(1))
  byId('todayButton').addEventListener('click', () => { closeMenu(false); dateInput.value = localDate(); renderTimeline() })
  byId('addActivity').addEventListener('click', () => openEditor())
  for (const id of ['closeEditor', 'cancelEditor']) byId(id).addEventListener('click', () => editor.close())
  editor.addEventListener('close', () => {
    closeTimePicker()
    const focused = document.activeElement
    if (detailActivityId) {
      (editorScope === 'matter' ? byId('editMatter') : [...document.querySelectorAll('.detail-session')].find(row=>row.dataset.sessionId===editingSessionId)?.querySelector('.session-edit'))?.focus()
    } else if (page === 'timeline' && (focused === document.body || editor.contains(focused))) {
      (findMenuTrigger(editorReturnActivityId, editorReturnEntryKey) || byId('addActivity')).focus()
    }
  })
  byId('activityEditorForm').addEventListener('input',updateEditorDuration)
  byId('recordActivity').addEventListener('change',updateMatterSelection)
  byId('editActivityDate').addEventListener('change',() => { updateEndDay(); updateEditorDuration() })
  byId('endDayToggle').addEventListener('click',() => {
    editorEndDayOffset = editorEndDayOffset === 0 ? 1 : 0
    editorEndDayExplicit = true
    updateEndDay()
    updateEditorDuration()
  })
  for (const id of ['editActivityStart','editActivityEnd']) byId(id).addEventListener('change',() => {
    updateEndDay()
    updateEditorDuration()
  })
  byId('activityEditorForm').addEventListener('submit', async event => {
    event.preventDefault()
    try {
      if (editorScope === 'matter') {
        if (await command('matter-edit',{id:editorReturnActivityId,name:byId('editActivityName').value,status:byId('editMatterStatus').value})) editor.close()
        return
      }
      const payload = { id: editing?.id, name: byId('editActivityName').value,
        startTime: inputTime(byId('editActivityStart')), endTime: byId('editActivityEnd').value ? inputTime(byId('editActivityEnd')) : null,
        segments: editorSegments() }
      if (editorScope === 'session') {
        if (await command('session-edit',{...payload,activityId:editorReturnActivityId,sessionId:editingSessionId,progress:byId('editSessionProgress').value})) editor.close()
      } else if (await command('session-add',{...payload,activityId:byId('recordActivity').value || null,progress:byId('editSessionProgress').value})) editor.close()
    } catch {
      byId('editorError').textContent = '请填写有效的日期与开始、结束时间'
      byId('editorError').scrollIntoView({ block: 'nearest' })
    }
  })

  window.api.onActivities(setState)
  window.api.getActivities().then(setState).catch(error => message(`活动读取失败：${error.message}`))
  setInterval(() => {
    const activity = current()
    if (activity && page === 'current') byId('currentTimer').textContent = clock(duration(activity))
    if (page === 'timeline' && dateInput.value) {
      if (timelineRenderDay !== localDate()) { renderTimeline(); return }
      const bounds = dayBounds(dateInput.value)
      updateDayTotal(bounds, Date.now())
      const entry = activity && timelineEntries([activity], dateInput.value).find(entry => entry.status === 'running')
      const detail = entry && [...document.querySelectorAll('.timeline-item')].find(row => row.dataset.entryKey === entry.entryKey)?.querySelector('.timeline-duration')
      applyFocus()
      updateGaps(Date.now())
      if (detailActivityId && activity?.id === detailActivityId) {
        byId('matterTotal').textContent = humanDuration(duration(activity))
        for (const row of byId('matterSessions').querySelectorAll('.detail-session')) {
          const visit = timelineEntries([activity],row.dataset.day).find(item=>item.sessionId===row.dataset.sessionId)
          if (visit?.status === 'running') {
            row.querySelector('.detail-session-meta').textContent = `${timeLabel(visit.startTime,row.dataset.day)}–${visit.endTime ? timeLabel(visit.endTime,row.dataset.day) : '现在'} · ${humanDuration(duration(visit,Date.now(),dayBounds(row.dataset.day)))}`
            paintStrip(row,activity,duration(visit))
          }
        }
      }
      if (detail) {
        detail.textContent = humanDuration(duration(entry, Date.now(), bounds))
        paintStrip(detail.closest('.timeline-item'),entry,duration(entry))
      }
    }
  }, 1000)
})()
