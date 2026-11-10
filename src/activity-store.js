const fs = require('fs')
const path = require('path')
const { randomUUID } = require('crypto')
const { sessionsOf, ensureSessions, appendSession, syncSegments } = require('./activity-sessions')
const { chooseMatterColor } = require('./activity-colors')

const iso = time => new Date(time).toISOString()
const copy = value => JSON.parse(JSON.stringify(value))

function timestamp(value) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw new Error('时间格式无效')
  return Date.parse(value)
}

function validateActivity(activity) {
  if (!activity || typeof activity.id !== 'string' || !activity.id) throw new Error('记录 ID 无效')
  if (typeof activity.name !== 'string' || !activity.name.trim() || activity.name.length > 200) throw new Error('活动名称须为 1–200 个字符')
  if (activity.color !== undefined && !/^#[\da-f]{6}$/i.test(activity.color)) throw new Error('事项颜色无效')
  if (!['running', 'paused', 'completed'].includes(activity.status)) throw new Error('活动状态无效')
  const start = timestamp(activity.startTime)
  const end = activity.endTime === null ? Infinity : timestamp(activity.endTime)
  if (end < start || (activity.status === 'completed') !== (activity.endTime !== null)) throw new Error('结束时间必须晚于或等于开始时间')
  if (!Array.isArray(activity.segments)) throw new Error('有效时间段无效')
  let previousEnd = start
  let openCount = 0
  for (const [index, segment] of activity.segments.entries()) {
    const from = timestamp(segment.start)
    const to = segment.end === null ? Infinity : timestamp(segment.end)
    if (from < previousEnd || to < from || to > end) throw new Error('有效时间段必须按顺序排列，且位于开始和结束时间之间')
    if (segment.end === null) {
      openCount++
      if (activity.status !== 'running' || index !== activity.segments.length - 1) throw new Error('只有进行中的最后一段可以没有结束时间')
    }
    previousEnd = to
  }
  if ((activity.status === 'running' && openCount !== 1) || openCount > 1) throw new Error('进行中活动必须有一个开放时间段')
}

function validateDocument(data) {
  if (!data || ![1, 2].includes(data.version) || !Array.isArray(data.activities)) throw new Error('无法识别活动数据版本，请保留文件并使用兼容版本')
  if (data.checkpointAt !== null) timestamp(data.checkpointAt)
  const ids = new Set()
  let active = 0
  for (const activity of data.activities) {
    validateActivity(activity)
    if (ids.has(activity.id)) throw new Error('存在重复记录 ID')
    ids.add(activity.id)
    if (activity.status === 'running' || (data.version === 1 && activity.status === 'paused')) active++
  }
  if (active > 1) throw new Error('存在多项前台计时活动')
  if (data.sessionVersion !== undefined && data.sessionVersion !== 1) throw new Error('无法识别本次记录的数据版本')
  const sessionIds = new Set()
  for (const activity of data.activities) {
    if (!Array.isArray(activity.sessions)) continue
    for (const session of activity.sessions) {
      if (typeof session.id !== 'string' || !session.id || sessionIds.has(session.id)) throw new Error('本次记录 ID 无效或重复')
      sessionIds.add(session.id)
      if (typeof session.progress !== 'string' || session.progress.length > 2000) throw new Error('本次进展最多 2000 个字符')
      validateActivity({...activity, id:session.id, startTime:session.startTime, endTime:session.endTime,
        status:session.endTime === null ? 'running' : 'completed', segments:session.segments})
      if (session.endTime === null && activity.status !== 'running') throw new Error('暂停事项不能包含正在计时的记录')
    }
    const flat = activity.sessions.flatMap(session=>session.segments).sort((a,b)=>timestamp(a.start)-timestamp(b.start))
    if (JSON.stringify(flat) !== JSON.stringify(activity.segments)) throw new Error('本次记录与有效时间段不一致')
  }
  const intervals = data.activities.flatMap(activity => activity.segments.map(segment => ({
    start: timestamp(segment.start), end: segment.end === null ? Infinity : timestamp(segment.end), name: activity.name
  }))).filter(interval => interval.end > interval.start).sort((a, b) => a.start - b.start)
  for (let index = 1; index < intervals.length; index++) {
    if (intervals[index].start < intervals[index - 1].end) throw new Error('不同事项的有效时间段重叠')
  }
  if (data.trash !== undefined && !Array.isArray(data.trash)) throw new Error('活动回收站格式无效')
  const trashIds = new Set()
  for (const entry of data.trash || []) {
    if (!entry || !['matter','session'].includes(entry.kind)) throw new Error('无法识别活动回收站版本')
    if (typeof entry.id !== 'string' || !entry.id || trashIds.has(entry.id)) throw new Error('回收站记录 ID 无效或重复')
    trashIds.add(entry.id)
    timestamp(entry.deletedAt)
    validateActivity(entry.activity)
    if (entry.activity.status === 'running') throw new Error('回收站事项必须停止计时')
    const activity = entry.kind === 'matter' ? entry.activity : {
      ...entry.activity, startTime:entry.session.startTime, endTime:entry.session.endTime,
      status:'completed', sessions:[entry.session], segments:entry.session.segments
    }
    validateDocument({version:2,sessionVersion:1,checkpointAt:null,activities:[activity]})
  }
}

function nextMatterColor(data) {
  return chooseMatterColor([...data.activities.map(activity => activity.color),...(data.trash || []).map(entry => entry.activity.color)])
}

function assertNoOverlap(candidate, others) {
  for (const other of others) {
    if (other.id === candidate.id) continue
    for (const first of candidate.segments) {
      for (const second of other.segments) {
        const start = Math.max(timestamp(first.start), timestamp(second.start))
        const end = Math.min(first.end === null ? Infinity : timestamp(first.end), second.end === null ? Infinity : timestamp(second.end))
        if (start < end) throw new Error(`时间冲突：与「${other.name}」的有效时间段重叠，请调整时间`)
      }
    }
  }
}

function atomicSave(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temporary = `${file}.tmp`
  let descriptor
  try {
    descriptor = fs.openSync(temporary, 'w')
    fs.writeFileSync(descriptor, JSON.stringify(data, null, 2), 'utf8')
    fs.fsyncSync(descriptor)
    fs.closeSync(descriptor)
    descriptor = undefined
    if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.bak`)
    fs.renameSync(temporary, file)
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor)
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary)
  }
}

class ActivityStore {
  constructor(file, { now = Date.now, write = atomicSave } = {}) {
    this.file = file
    this.now = now
    this.write = write
    this.error = null
    this.notice = null
    this.data = { version: 2, sessionVersion: 1, checkpointAt: null, activities: [], trash: [] }
    this.load()
  }

  load() {
    if (!fs.existsSync(this.file)) return
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'))
      // Never downgrade a future schema using an older backup.
      if (![1, 2].includes(raw.version)) throw new Error('无法识别活动数据版本，请保留文件并使用兼容版本')
      validateDocument(raw)
      this.data = raw
    } catch (error) {
      if (error.message.includes('版本')) { this.error = error.message; return }
      try {
        const backup = JSON.parse(fs.readFileSync(`${this.file}.bak`, 'utf8'))
        validateDocument(backup)
        fs.copyFileSync(this.file, `${this.file}.damaged-${Date.now()}-${randomUUID()}`)
        this.data = backup
        this.notice = '活动文件损坏，已恢复上一份备份。损坏原件已保留，请检查最近的记录。'
      } catch {
        this.error = '活动数据读取失败，已停止写入以保护原文件。请备份 activity-log.json 后检查或恢复其 .bak 文件。'
        return
      }
    }
    const migrating = this.data.version === 1 || this.data.sessionVersion !== 1 || this.data.activities.some(activity=>!Array.isArray(activity.sessions) || !activity.color)
    if (migrating) {
      try {
        this.migrationBackup = `${this.file}.v${this.data.version}-backup-${Date.now()}-${randomUUID()}.json`
        atomicSave(this.migrationBackup, this.data)
        this.data.version = 2
        this.data.sessionVersion = 1
        for (const activity of this.data.activities) {
          ensureSessions(activity)
          if (!activity.color) activity.color = nextMatterColor(this.data)
        }
      } catch {
        this.error = '旧版活动备份失败，已停止迁移，请检查目录权限和磁盘空间。'
        return
      }
    }
    const current = this.current()
    let recovered = false
    if (current?.status === 'running') {
      const segment = current.segments[current.segments.length - 1]
      const checkpoint = this.data.checkpointAt ? timestamp(this.data.checkpointAt) : timestamp(segment.start)
      const cutoff = Math.max(timestamp(segment.start), Math.min(this.now(), checkpoint))
      this.closeSegment(current, cutoff)
      current.status = 'paused'
      current.pauseReason = 'interrupted'
      current.updatedAt = iso(cutoff)
      recovered = true
      this.notice = [this.notice, '上次运行意外中断，已恢复到最近检查点并暂停。检查点通常间隔 30 秒，可在时间轴中修正。'].filter(Boolean).join(' ')
    }
    if (migrating || recovered) {
      try { this.write(this.file, this.data) } catch { this.error = '迁移或恢复状态保存失败，请检查磁盘空间和目录权限。原文件和备份已保留。' }
    }
  }

  current(data = this.data) { return data.activities.find(activity => activity.status === 'running') }

  paused(data = this.data) { return data.activities.filter(activity => activity.status === 'paused') }

  get(id, data = this.data) { return data.activities.find(activity => activity.id === id) }

  snapshot() { return { ...copy(this.data), error: this.error, notice: this.notice } }

  commit(change) {
    if (this.error) throw new Error(this.error)
    const draft = copy(this.data)
    const time = this.now()
    change(draft, time)
    draft.revision = (this.data.revision || 0) + 1
    draft.checkpointAt = iso(time)
    validateDocument(draft)
    try { this.write(this.file, draft) } catch (error) { throw new Error(`保存活动失败，操作未提交。请检查磁盘空间和目录权限。${error.code || ''}`) }
    this.data = draft
    return this.snapshot()
  }

  closeSegment(activity, time) {
    ensureSessions(activity)
    for (const session of activity.sessions) {
      const segment = session.segments[session.segments.length - 1]
      if (segment && segment.end === null) {
        segment.end = iso(Math.max(timestamp(segment.start), time))
        session.endTime = segment.end
      }
    }
    syncSegments(activity)
  }

  finish(activity, time) {
    this.closeSegment(activity, time)
    const last = activity.segments[activity.segments.length - 1]
    activity.endTime = iso(Math.max(time, timestamp(activity.startTime), last ? timestamp(last.end) : 0))
    activity.status = 'completed'
    activity.pauseReason = null
    activity.updatedAt = activity.endTime
  }

  pauseRecord(activity, time, reason) {
    this.closeSegment(activity, time)
    activity.status = 'paused'
    activity.pauseReason = reason
    activity.updatedAt = iso(time)
  }

  start(name, todoId = null) {
    name = typeof name === 'string' ? name.trim() : ''
    if (!name || name.length > 200) throw new Error('活动名称须为 1–200 个字符')
    return this.commit((draft, time) => {
      const current = this.current(draft)
      if (current) this.pauseRecord(current, time, 'switch')
      const activity = { id: randomUUID(), name, color:nextMatterColor(draft), startTime: iso(time), endTime: null, status: 'running',
        segments: [], sessions: [], nextSessionIndex:0, todoId: typeof todoId === 'string' ? todoId : null,
        createdAt: iso(time), updatedAt: iso(time), pauseReason: null }
      appendSession(activity,time)
      assertNoOverlap(activity, draft.activities)
      draft.activities.push(activity)
    })
  }

  pause(reason = 'manual', cutoff) {
    if (this.current()?.status !== 'running') return this.snapshot()
    return this.commit((draft, time) => {
      const current = this.current(draft)
      this.pauseRecord(current, cutoff === undefined ? time : cutoff, reason)
      current.updatedAt = iso(time)
    })
  }

  resume(id) {
    const paused = this.paused()
    if (!id && paused.length > 1) throw new Error('请选择要继续的后台事项')
    const targetId = id || paused[0]?.id
    if (targetId && this.current()?.id === targetId) return this.snapshot()
    return this.commit((draft, time) => {
      const current = this.get(targetId, draft)
      if (!current || current.status !== 'paused') throw new Error('当前没有可继续的活动')
      const last = current.segments[current.segments.length - 1]
      if (time < timestamp(current.startTime) || (last && time < timestamp(last.end))) throw new Error('系统时间早于上次记录，请检查系统时钟')
      const foreground = this.current(draft)
      if (foreground) this.pauseRecord(foreground, time, 'switch')
      appendSession(current,time)
      current.status = 'running'
      current.pauseReason = null
      current.updatedAt = iso(time)
      assertNoOverlap(current, draft.activities)
    })
  }

  end(id) {
    const activity = id ? this.get(id) : this.current()
    if (!activity && !id) return this.snapshot()
    if (!activity) throw new Error('事项已不存在')
    if (activity.status === 'completed') return this.snapshot()
    return this.commit((draft, time) => this.finish(this.get(activity.id, draft), time))
  }

  edit(input) {
    return this.commit((draft, time) => {
      const existing = input.id ? draft.activities.find(activity => activity.id === input.id) : null
      if (input.id && !existing) throw new Error('记录已不存在，请刷新时间轴')
      if (existing?.status === 'running') throw new Error('请先暂停活动，再修改时间记录')
      const startTime = iso(timestamp(input.startTime))
      const endTime = input.endTime ? iso(timestamp(input.endTime)) : null
      if (!existing && !endTime) throw new Error('补录活动必须填写结束时间')
      const activity = { ...existing, id: existing?.id || randomUUID(), name: String(input.name || '').trim(), color:existing?.color || nextMatterColor(draft),
        startTime, endTime, status: endTime ? 'completed' : 'paused',
        segments: Array.isArray(input.segments) ? input.segments.map(segment => ({start: iso(timestamp(segment.start)), end: iso(timestamp(segment.end))})) : [],
        todoId: existing?.todoId || null, createdAt: existing?.createdAt || iso(time), updatedAt: iso(time), pauseReason: endTime ? null : 'manual' }
      validateActivity(activity)
      if (timestamp(startTime) > time || (endTime && timestamp(endTime) > time) || activity.segments.some(segment => timestamp(segment.end) > time)) throw new Error('不能补录未来的活动时间')
      assertNoOverlap(activity, draft.activities)
      const sameIntervals = existing && JSON.stringify(existing.segments) === JSON.stringify(activity.segments)
      if (!sameIntervals) {
        if (existing && sessionsOf(existing).length > 1) throw new Error('请在事项详情中逐次编辑记录')
        const previous = existing && sessionsOf(existing)[0]
        activity.sessions = [{id:previous?.id || `${activity.id}:0`, startTime:activity.startTime,
          endTime:activity.endTime || activity.segments.at(-1)?.end || activity.startTime,
          progress:previous?.progress || String(input.progress || ''), segments:copy(activity.segments)}]
        activity.nextSessionIndex = existing?.nextSessionIndex || 1
      }
      if (existing) draft.activities[draft.activities.indexOf(existing)] = activity
      else draft.activities.push(activity)
    })
  }

  remove(id) {
    return this.commit((draft,time) => {
      const activity = this.get(id,draft)
      if (!activity) throw new Error('记录已不存在')
      if (activity.status === 'running') this.pauseRecord(activity,time,'trash')
      draft.trash ||= []
      draft.trash.push({id:randomUUID(),kind:'matter',deletedAt:iso(time),activity:copy(activity)})
      draft.activities = draft.activities.filter(activity => activity.id !== id)
    })
  }

  addSession(input) {
    return this.commit((draft,time) => {
      const startTime = iso(timestamp(input.startTime))
      const endTime = iso(timestamp(input.endTime))
      if (timestamp(endTime) > time) throw new Error('不能补录未来的活动时间')
      const progress = input.progress === undefined ? '' : input.progress
      if (typeof progress !== 'string' || progress.length > 2000) throw new Error('本次进展最多 2000 个字符')
      let activity = input.activityId ? this.get(input.activityId,draft) : null
      if (input.activityId && !activity) throw new Error('事项已不存在，请重新选择')
      const creating = !activity
      if (creating) activity = {
        id: randomUUID(), name: typeof input.name === 'string' ? input.name.trim() : '', color:nextMatterColor(draft),
        startTime, endTime, status: 'completed', segments: [], sessions: [], nextSessionIndex: 0,
        todoId: null, createdAt: iso(time), updatedAt: iso(time), pauseReason: null
      }
      ensureSessions(activity)
      const session = {
        id: `${activity.id}:${activity.nextSessionIndex++}`,
        startTime, endTime, progress: progress.trim(), segments: [{start:startTime,end:endTime}]
      }
      validateActivity({...activity,startTime,endTime,status:'completed',segments:session.segments})
      // Use the visit ID to also check against existing visits of this same matter.
      assertNoOverlap({...activity,id:session.id,segments:session.segments},draft.activities)
      activity.sessions.push(session)
      activity.sessions.sort((a,b) => timestamp(a.startTime)-timestamp(b.startTime))
      syncSegments(activity)
      activity.startTime = iso(Math.min(timestamp(activity.startTime),timestamp(startTime)))
      if (activity.status === 'completed') activity.endTime = iso(Math.max(timestamp(activity.endTime),timestamp(endTime)))
      activity.updatedAt = iso(time)
      if (creating) draft.activities.push(activity)
    })
  }

  setProgress(activityId, sessionId, progress) {
    if (typeof progress !== 'string' || progress.length > 2000) throw new Error('本次进展最多 2000 个字符')
    return this.commit((draft,time)=>{
      const activity = this.get(activityId,draft)
      const session = activity && ensureSessions(activity).find(session=>session.id===sessionId)
      if (!session) throw new Error('本次记录已不存在')
      session.progress = progress.trim()
      activity.updatedAt = iso(time)
    })
  }

  updateMatter(id, input) {
    return this.commit((draft,time)=>{
      const activity = this.get(id,draft)
      if (!activity) throw new Error('事项已不存在')
      const name = typeof input.name === 'string' ? input.name.trim() : ''
      if (!name || name.length > 200) throw new Error('事项名称须为 1–200 个字符')
      if (!['running','paused','completed'].includes(input.status)) throw new Error('事项状态无效')
      activity.name = name
      if (input.status === 'completed' && activity.status !== 'completed') this.finish(activity,time)
      if (input.status === 'paused' && activity.status !== 'paused') {
        this.pauseRecord(activity,time,'manual')
        activity.endTime = null
      }
      if (input.status === 'running' && activity.status !== 'running') {
        const last = activity.segments.at(-1)
        if (last && time < timestamp(last.end)) throw new Error('系统时间早于上次记录')
        const foreground = this.current(draft)
        if (foreground) this.pauseRecord(foreground,time,'switch')
        appendSession(activity,time)
        activity.status = 'running'
        activity.endTime = null
        activity.pauseReason = null
      }
      activity.updatedAt = iso(time)
      assertNoOverlap(activity,draft.activities)
    })
  }

  editSession(input) {
    return this.commit((draft,time)=>{
      const activity = this.get(input.activityId,draft)
      const session = activity && ensureSessions(activity).find(session=>session.id===input.sessionId)
      if (!session) throw new Error('本次记录已不存在')
      if (session.endTime === null) throw new Error('请先暂停本次记录，再修改时间')
      const edited = {id:session.id, startTime:iso(timestamp(input.startTime)), endTime:iso(timestamp(input.endTime)),
        progress:String(input.progress || '').trim(), segments:input.segments.map(segment=>({start:iso(timestamp(segment.start)),end:iso(timestamp(segment.end))}))}
      validateActivity({...activity,id:edited.id,status:'completed',startTime:edited.startTime,endTime:edited.endTime,segments:edited.segments})
      if (timestamp(edited.endTime)>time || edited.segments.some(segment=>timestamp(segment.end)>time)) throw new Error('不能补录未来的活动时间')
      activity.sessions[activity.sessions.indexOf(session)] = edited
      activity.sessions.sort((a,b)=>timestamp(a.startTime)-timestamp(b.startTime))
      syncSegments(activity)
      activity.startTime = activity.sessions[0].startTime
      if (activity.endTime) activity.endTime = iso(Math.max(timestamp(activity.endTime),...activity.sessions.map(session=>timestamp(session.endTime))))
      activity.updatedAt = iso(time)
      assertNoOverlap(activity,draft.activities)
    })
  }

  deleteSession(activityId,sessionId) {
    return this.commit((draft,time)=>{
      const activity = this.get(activityId,draft)
      const session = activity && ensureSessions(activity).find(session=>session.id===sessionId)
      if (!session) throw new Error('本次记录已不存在')
      if (session.endTime === null) this.pauseRecord(activity,time,'manual')
      const parent = {...copy(activity),sessions:[],segments:[]}
      if (parent.status === 'running') { parent.status = 'paused'; parent.pauseReason = 'trash' }
      draft.trash ||= []
      draft.trash.push({id:randomUUID(),kind:'session',deletedAt:iso(time),activity:parent,session:copy(session)})
      activity.sessions = activity.sessions.filter(session=>session.id!==sessionId)
      syncSegments(activity)
      activity.updatedAt = iso(time)
    })
  }

  restoreTrash(id) {
    return this.commit((draft,time) => {
      const entry = (draft.trash || []).find(entry => entry.id===id)
      if (!entry) throw new Error('回收站记录已不存在')
      const incoming = copy(entry.activity)
      if (entry.kind === 'session') incoming.sessions = [copy(entry.session)]
      ensureSessions(incoming)
      let target = this.get(incoming.id,draft)
      if (target) {
        ensureSessions(target)
        if (incoming.sessions.some(session => target.sessions.some(existing => existing.id===session.id))) throw new Error('同一记录已存在，无法重复恢复')
        target.sessions.push(...incoming.sessions)
        target.nextSessionIndex = Math.max(target.nextSessionIndex,incoming.nextSessionIndex)
      } else {
        target = incoming
        draft.activities.push(target)
      }
      target.sessions.sort((a,b) => timestamp(a.startTime)-timestamp(b.startTime))
      syncSegments(target)
      target.startTime = iso(Math.min(timestamp(target.startTime),...target.sessions.map(session => timestamp(session.startTime))))
      if (target.status === 'completed') target.endTime = iso(Math.max(timestamp(target.endTime),...target.sessions.map(session => timestamp(session.endTime))))
      target.updatedAt = iso(time)
      assertNoOverlap(target,draft.activities)
      draft.trash = draft.trash.filter(entry => entry.id!==id)
    })
  }

  deleteTrash(id) {
    return this.commit(draft => {
      if (!(draft.trash || []).some(entry => entry.id===id)) throw new Error('回收站记录已不存在')
      draft.trash = draft.trash.filter(entry => entry.id!==id)
    })
  }

  checkpoint() {
    if (this.needsFlush) {
      const snapshot = this.commit(() => {})
      this.needsFlush = false
      return snapshot
    }
    if (this.current()?.status !== 'running') return this.snapshot()
    const previous = this.data.checkpointAt ? timestamp(this.data.checkpointAt) : this.now()
    const elapsed = this.now() - previous
    if (elapsed > 90000 || elapsed < 0) return this.pause('clock-gap', previous)
    return this.commit(() => {})
  }
}

module.exports = { ActivityStore, validateDocument, validateActivity, assertNoOverlap, atomicSave }
