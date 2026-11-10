const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { ActivityStore, validateDocument } = require('../src/activity-store')
const { duration, dayBounds, timelineEntries, matterColor, durationOpacity, untrackedGaps, sessionDays } = require('../src/activity-time')
const { resizeSessionSegments } = require('../src/activity-sessions')

const minute = 60000
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'floatodo-sessions-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  let time = +new Date(2026, 10, 9, 9)
  const file = path.join(directory, 'activity-log.json')
  const options = { now: () => time }
  const store = new ActivityStore(file, options)
  return { store, file, options, advance: minutes => { time += minutes * minute }, now: () => time }
}

test('A → B → C → A retains stable matters, separate visit IDs and original chronology', t => {
  const f = fixture(t)
  f.store.start('A', 'todo-A')
  const a = f.store.current().id
  f.advance(8)
  f.store.start('B')
  f.advance(12)
  f.store.start('C')
  f.advance(5)
  f.store.resume(a)
  f.advance(40)
  f.store.pause()
  const entries = timelineEntries(f.store.data.activities, '2026-11-09', f.now() + 86400000)
  assert.deepEqual(entries.map(entry => entry.name), ['A', 'B', 'C', 'A'])
  assert.equal(entries[0].id, entries[3].id)
  assert.notEqual(entries[0].sessionId, entries[3].sessionId)
  assert.equal(f.store.get(a).todoId, 'todo-A')
  assert.equal(duration(f.store.get(a), f.now()), 48 * minute)
  assert.equal(f.store.paused().length, 3)
  validateDocument(f.store.data)
})

test('progress belongs to one visit and does not pause, restart or change effective intervals', t => {
  const f = fixture(t)
  f.store.start('A')
  const id = f.store.current().id
  const first = f.store.get(id).sessions[0].id
  f.advance(10)
  const before = structuredClone(f.store.get(id))
  f.store.setProgress(id, first, '编写需求')
  assert.equal(f.store.current().id, id)
  assert.deepEqual(f.store.get(id).segments, before.segments)
  assert.equal(f.store.get(id).startTime, before.startTime)
  f.store.pause()
  f.advance(20)
  f.store.resume(id)
  const second = f.store.get(id).sessions[1].id
  f.store.setProgress(id, second, '试用功能')
  assert.equal(f.store.get(id).sessions[0].progress, '编写需求')
  assert.equal(f.store.get(id).sessions[1].progress, '试用功能')
  const snapshot = f.store.snapshot()
  assert.throws(() => f.store.setProgress(id, second, 'x'.repeat(2001)), /2000/)
  assert.deepEqual(f.store.snapshot(), snapshot)
})

test('session edits preserve millisecond precision, other visits, matter status and stable identity', t => {
  const f = fixture(t)
  f.store.start('A')
  const id = f.store.current().id
  f.advance(20)
  f.store.pause()
  f.advance(20)
  f.store.resume(id)
  f.advance(20)
  f.store.pause()
  const [first, second] = structuredClone(f.store.get(id).sessions)
  const split = new Date(Date.parse(first.startTime) + 8 * minute + 123).toISOString()
  const resumed = new Date(Date.parse(first.startTime) + 12 * minute + 456).toISOString()
  f.store.editSession({ activityId: id, sessionId: first.id, ...first, progress: '修正暂停',
    segments: [{ start: first.startTime, end: split }, { start: resumed, end: first.endTime }] })
  assert.equal(f.store.get(id).sessions[0].id, first.id)
  assert.deepEqual(f.store.get(id).sessions[1], second)
  assert.equal(f.store.get(id).status, 'paused')
  assert.equal(f.store.get(id).segments[0].end, split)
  assert.equal(timelineEntries([f.store.get(id)], '2026-11-09', f.now()).length, 2)
  assert.equal(duration(f.store.get(id), f.now()), 36 * minute - 333)
})

test('single visit deletion retains matter, other visits and unrelated foreground; IDs are never reused', t => {
  const f = fixture(t)
  f.store.start('A')
  const id = f.store.current().id
  f.advance(5)
  f.store.pause()
  f.store.resume(id)
  f.advance(5)
  f.store.start('B')
  const b = f.store.current().id
  const [first, second] = structuredClone(f.store.get(id).sessions)
  f.store.deleteSession(id, first.id)
  assert.deepEqual(f.store.get(id).sessions, [second])
  assert.equal(f.store.current().id, b)
  f.store.resume(id)
  assert.equal(f.store.get(id).sessions.at(-1).id, `${id}:2`)
  f.store.deleteSession(id, `${id}:2`)
  assert.equal(f.store.get(id).status, 'paused')
  f.store.deleteSession(id, second.id)
  assert.equal(f.store.get(id).sessions.length, 0)
  f.store.resume(id)
  assert.equal(f.store.get(id).sessions[0].id, `${id}:3`)
})

test('matter edits retain hue, notes, visit times and associated todo; status reopening is explicit', t => {
  const f = fixture(t)
  f.store.start('A', 'todo')
  const id = f.store.current().id
  f.advance(5)
  f.store.end()
  f.store.setProgress(id, f.store.get(id).sessions[0].id, '完成初稿')
  const before = structuredClone(f.store.get(id))
  const hue = matterColor(id)
  f.store.updateMatter(id, { name: '重命名', status: 'completed' })
  assert.deepEqual(f.store.get(id).sessions, before.sessions)
  assert.deepEqual(matterColor(id), hue)
  assert.equal(f.store.get(id).todoId, 'todo')
  f.store.updateMatter(id, { name: '重命名', status: 'paused' })
  assert.equal(f.store.get(id).endTime, null)
  f.store.updateMatter(id, { name: '重命名', status: 'running' })
  assert.equal(f.store.get(id).sessions.length, 2)
  assert.equal(f.store.current().id, id)
})

test('same names are independent matters and never merge visits', t => {
  const f = fixture(t)
  f.store.start('一样')
  f.advance(5)
  f.store.start('一样')
  const [a, b] = f.store.data.activities
  assert.notEqual(a.id, b.id)
  assert.notEqual(a.sessions[0].id, b.sessions[0].id)
})

test('duration opacity uses exact 15/30/60 minute thresholds independent of stable matter hue', () => {
  assert.deepEqual([0, 15 * minute - 1, 15 * minute, 30 * minute, 60 * minute].map(durationOpacity), [.3, .3, .5, .75, 1])
  assert.deepEqual(matterColor('stable-id'), matterColor('stable-id'))
  assert.match(matterColor('stable-id').hex, /^#[a-f\d]{6}$/)
  assert.notEqual(matterColor('A').hex, matterColor('B').hex)
})

test('untracked gaps use the union of all matters, preserve real blanks and never label B as a gap in A', t => {
  const f = fixture(t)
  f.store.start('A')
  f.advance(10)
  f.store.start('B')
  f.advance(20)
  f.store.pause()
  f.advance(15)
  f.store.resume(f.store.data.activities[0].id)
  f.advance(10)
  f.store.pause()
  const gaps = untrackedGaps(f.store.data.activities, '2026-11-09', f.now())
  assert.equal(gaps.length, 1)
  assert.equal(Date.parse(gaps[0].endTime) - Date.parse(gaps[0].startTime), 15 * minute)
  f.advance(5)
  assert.equal(untrackedGaps(f.store.data.activities, '2026-11-09', f.now()).length, 2)
  assert.deepEqual(untrackedGaps([], '2026-11-09', f.now()), [])
})

test('cross-midnight visits stay single raw records, allocate effort and carry progress on both dates', t => {
  const f = fixture(t)
  f.advance(14 * 60 + 30)
  f.store.start('跨天')
  const id = f.store.current().id
  f.store.setProgress(id, f.store.get(id).sessions[0].id, '跨天进展')
  f.advance(60)
  const runningPast = timelineEntries([f.store.get(id)], '2026-11-09', f.now())[0]
  assert.equal(Date.parse(runningPast.endTime), dayBounds('2026-11-09')[1])
  f.store.end()
  assert.deepEqual(sessionDays(f.store.get(id), f.now()), ['2026-11-09', '2026-11-10'])
  for (const day of sessionDays(f.store.get(id), f.now())) {
    const entry = timelineEntries([f.store.get(id)], day, f.now())[0]
    assert.equal(entry.progress, '跨天进展')
    assert.equal(duration(entry, f.now(), dayBounds(day)), 30 * minute)
  }
  assert.equal(f.store.get(id).sessions.length, 1)
  assert.equal(duration(f.store.get(id), f.now()), 60 * minute)
})

test('time conflicts, reversed bounds and open session edits fail atomically', t => {
  const f = fixture(t)
  f.store.start('A')
  f.advance(10)
  f.store.start('B')
  f.advance(10)
  const [a, b] = structuredClone(f.store.data.activities)
  const before = f.store.snapshot()
  assert.throws(() => f.store.editSession({ activityId: b.id, sessionId: b.sessions[0].id, ...b.sessions[0] }), /暂停/)
  assert.throws(() => f.store.editSession({ activityId: a.id, sessionId: a.sessions[0].id, ...a.sessions[0],
    endTime: new Date(f.now()).toISOString(), segments: [{ start: a.startTime, end: new Date(f.now()).toISOString() }] }), /冲突/)
  assert.throws(() => f.store.editSession({ activityId: a.id, sessionId: a.sessions[0].id, ...a.sessions[0],
    startTime: a.sessions[0].endTime, endTime: a.startTime }), /结束/)
  assert.deepEqual(f.store.snapshot(), before)
})

test('real legacy v2 data is backed up before session migration with IDs, canonical intervals and empty history preserved', t => {
  const f = fixture(t)
  f.store.start('A')
  f.advance(10)
  f.store.pause()
  f.advance(10)
  f.store.resume()
  f.advance(5)
  f.store.end()
  const legacy = structuredClone(f.store.data)
  delete legacy.sessionVersion
  for (const activity of legacy.activities) { delete activity.sessions; delete activity.nextSessionIndex }
  legacy.activities.push({ ...legacy.activities[0], id: 'empty', name: '空历史', segments: [] })
  fs.writeFileSync(f.file, JSON.stringify(legacy))
  const migrated = new ActivityStore(f.file, f.options)
  assert.equal(migrated.error, null)
  assert.deepEqual(JSON.parse(fs.readFileSync(migrated.migrationBackup)), legacy)
  assert.equal(migrated.data.sessionVersion, 1)
  assert.equal(migrated.data.activities[0].id, legacy.activities[0].id)
  assert.deepEqual(migrated.data.activities[0].segments, legacy.activities[0].segments)
  assert.equal(migrated.data.activities[0].sessions.length, 2)
  assert.equal(migrated.get('empty').sessions.length, 1)
  const reopened = new ActivityStore(f.file, f.options)
  assert.equal(reopened.migrationBackup, undefined)
  assert.deepEqual(reopened.snapshot(), migrated.snapshot())
})

test('future session schemas are protected and session write failure leaves disk and memory intact', t => {
  const f = fixture(t)
  f.store.start('A')
  f.advance(1)
  f.store.pause()
  const before = f.store.snapshot()
  const disk = fs.readFileSync(f.file, 'utf8')
  f.store.write = () => { throw new Error('disk full') }
  const matter = f.store.data.activities[0]
  assert.throws(() => f.store.deleteSession(matter.id, matter.sessions[0].id), /保存/)
  assert.deepEqual(f.store.snapshot(), before)
  assert.equal(fs.readFileSync(f.file, 'utf8'), disk)
  fs.writeFileSync(f.file, JSON.stringify({ ...f.store.data, sessionVersion: 99 }))
  const futureDisk = fs.readFileSync(f.file, 'utf8')
  const future = new ActivityStore(f.file, f.options)
  assert.match(future.error, /版本/)
  assert.equal(fs.readFileSync(f.file, 'utf8'), futureDisk)
})

test('compact session edits preserve exact intervals when only progress changes', () => {
  const session = { startTime: '2026-11-09T01:00:00.123Z', endTime: '2026-11-09T02:00:00.456Z', segments: [
    { start: '2026-11-09T01:00:00.123Z', end: '2026-11-09T01:20:00.234Z' },
    { start: '2026-11-09T01:40:00.345Z', end: '2026-11-09T02:00:00.456Z' }
  ] }
  const original = structuredClone(session)
  const resized = resizeSessionSegments(session,session.startTime,session.endTime)
  assert.deepEqual(resized,session.segments)
  assert.notEqual(resized,session.segments)
  assert.deepEqual(session,original)
})

test('compact session boundary edits preserve internal pauses while clipping or extending outer edges', () => {
  const session = { startTime: '2026-11-09T01:00:00.000Z', endTime: '2026-11-09T02:00:00.000Z', segments: [
    { start: '2026-11-09T01:00:00.000Z', end: '2026-11-09T01:20:00.000Z' },
    { start: '2026-11-09T01:40:00.000Z', end: '2026-11-09T02:00:00.000Z' }
  ] }
  const clipped = resizeSessionSegments(session,'2026-11-09T01:10:00.000Z','2026-11-09T01:50:00.000Z')
  assert.deepEqual(clipped,[
    { start: '2026-11-09T01:10:00.000Z', end: '2026-11-09T01:20:00.000Z' },
    { start: '2026-11-09T01:40:00.000Z', end: '2026-11-09T01:50:00.000Z' }
  ])
  assert.equal(duration({segments:clipped}),20*minute)
  const expanded = resizeSessionSegments(session,'2026-11-09T00:50:00.000Z','2026-11-09T02:10:00.000Z')
  assert.equal(duration({segments:expanded}),60*minute)
  assert.equal(expanded[0].end,session.segments[0].end)
  assert.equal(expanded[1].start,session.segments[1].start)
  assert.deepEqual(resizeSessionSegments(session,'2026-11-09T01:25:00.000Z','2026-11-09T01:35:00.000Z'),[])
  const shifted = resizeSessionSegments(session,'2026-11-10T01:00:00.000Z','2026-11-10T02:00:00.000Z')
  assert.equal(duration({segments:shifted}),40*minute)
  assert.equal(shifted[0].end,'2026-11-10T01:20:00.000Z')
  assert.equal(shifted[1].start,'2026-11-10T01:40:00.000Z')
  assert.throws(() => resizeSessionSegments(session,session.endTime,session.startTime),/结束时间/)
})

test('compact editing computes continuous duration and preserves unrecorded edges and empty history', () => {
  const session = { startTime: '2026-11-09T01:00:00.000Z', endTime: '2026-11-09T02:00:00.000Z', segments: [
    { start: '2026-11-09T01:10:00.000Z', end: '2026-11-09T01:50:00.000Z' }
  ] }
  assert.deepEqual(resizeSessionSegments(session,'2026-11-09T00:50:00.000Z','2026-11-09T02:10:00.000Z'),session.segments)
  assert.deepEqual(resizeSessionSegments({...session,segments:[]},session.startTime,session.endTime),[])
  const continuous = {...session,segments:[{start:session.startTime,end:session.endTime}]}
  const resized = resizeSessionSegments(continuous,'2026-11-09T01:05:01.000Z','2026-11-09T01:10:02.000Z')
  assert.equal(duration({segments:resized}),301000)
  assert.throws(() => resizeSessionSegments(session,'invalid',session.endTime),/结束时间/)
})

test('manual entry appends an independent visit to a paused matter without interrupting foreground', t => {
  const f = fixture(t)
  f.store.start('A','todo-A')
  const a = f.store.current().id
  f.advance(10)
  f.store.pause()
  f.advance(10)
  f.store.start('B')
  const foreground = structuredClone(f.store.current())
  const original = structuredClone(f.store.get(a).sessions[0])
  f.store.addSession({activityId:a,startTime:new Date(2026,10,9,9,10,1).toISOString(),endTime:new Date(2026,10,9,9,15,2).toISOString(),progress:'补上讨论'})
  assert.equal(f.store.data.activities.length,2)
  assert.equal(f.store.get(a).status,'paused')
  assert.equal(f.store.get(a).todoId,'todo-A')
  assert.deepEqual(f.store.get(a).sessions[0],original)
  assert.equal(f.store.get(a).sessions[1].progress,'补上讨论')
  assert.notEqual(f.store.get(a).sessions[1].id,original.id)
  assert.equal(duration(f.store.get(a),f.now()),15*minute+1000)
  assert.deepEqual(f.store.current(),foreground)
})

test('completed matters accept earlier and later manual visits while keeping completion status and stable IDs', t => {
  const f = fixture(t)
  f.store.start('已完成','todo')
  const id = f.store.current().id
  f.advance(10)
  f.store.end()
  f.advance(20)
  const original = structuredClone(f.store.get(id).sessions[0])
  f.store.addSession({activityId:id,startTime:new Date(2026,10,9,8,30).toISOString(),endTime:new Date(2026,10,9,8,45).toISOString()})
  f.store.addSession({activityId:id,startTime:new Date(2026,10,9,9,15).toISOString(),endTime:new Date(2026,10,9,9,20).toISOString()})
  const matter = f.store.get(id)
  assert.equal(matter.status,'completed')
  assert.equal(matter.sessions.length,3)
  assert.deepEqual(matter.sessions.find(session => session.id === original.id),original)
  assert.equal(matter.sessions[0].id,`${id}:1`)
  assert.equal(matter.sessions[2].id,`${id}:2`)
  assert.equal(matter.startTime,new Date(2026,10,9,8,30).toISOString())
  assert.equal(matter.endTime,new Date(2026,10,9,9,20).toISOString())
  assert.equal(matter.todoId,'todo')
})

test('manual visits to the running matter retain its open visit and timing status', t => {
  const f = fixture(t)
  f.store.start('正在计时')
  const id = f.store.current().id
  const open = structuredClone(f.store.current().sessions[0])
  f.store.addSession({activityId:id,startTime:new Date(2026,10,9,8).toISOString(),endTime:new Date(2026,10,9,8,30).toISOString()})
  assert.equal(f.store.current().id,id)
  assert.equal(f.store.current().endTime,null)
  assert.deepEqual(f.store.current().sessions.at(-1),open)
  assert.equal(f.store.current().sessions[0].endTime,new Date(2026,10,9,8,30).toISOString())
  assert.equal(f.store.current().pauseReason,null)
})

test('new manual matters remain independent despite equal names and never pause the current matter', t => {
  const f = fixture(t)
  f.store.start('同名')
  const foreground = structuredClone(f.store.current())
  for (let hour=7;hour<9;hour++) f.store.addSession({name:'同名',startTime:new Date(2026,10,9,hour).toISOString(),endTime:new Date(2026,10,9,hour,30).toISOString(),progress:''})
  assert.equal(new Set(f.store.data.activities.map(matter => matter.id)).size,3)
  assert.deepEqual(f.store.current(),foreground)
  assert.equal(f.store.data.activities.filter(matter => matter.status === 'completed').length,2)
})

test('cross-midnight manual entry stores one session and apportions both local dates with second precision', t => {
  const f = fixture(t)
  f.store.addSession({name:'跨午夜补录',startTime:new Date(2026,10,8,23,30,1).toISOString(),endTime:new Date(2026,10,9,0,30,2).toISOString(),progress:'夜间讨论'})
  const matter = f.store.data.activities[0]
  assert.equal(matter.sessions.length,1)
  assert.equal(duration(matter),60*minute+1000)
  assert.equal(duration(matter,f.now(),dayBounds('2026-11-08')),30*minute-1000)
  assert.equal(duration(matter,f.now(),dayBounds('2026-11-09')),30*minute+2000)
  assert.equal(timelineEntries([matter],'2026-11-08',f.now())[0].sessionId,timelineEntries([matter],'2026-11-09',f.now())[0].sessionId)
})

test('manual entry rejects missing matters, invalid names, future times and self/other conflicts atomically', t => {
  const f = fixture(t)
  f.store.start('A')
  const a = f.store.current().id
  f.advance(10)
  f.store.start('B')
  f.advance(10)
  const before = f.store.snapshot()
  const disk = fs.readFileSync(f.file,'utf8')
  const input = {activityId:a,startTime:new Date(2026,10,9,9,2).toISOString(),endTime:new Date(2026,10,9,9,3).toISOString()}
  assert.throws(() => f.store.addSession(input),/重叠/)
  assert.throws(() => f.store.addSession({...input,startTime:new Date(2026,10,9,9,12).toISOString(),endTime:new Date(2026,10,9,9,13).toISOString()}),/冲突/)
  assert.throws(() => f.store.addSession({...input,activityId:'missing'}),/不存在/)
  assert.throws(() => f.store.addSession({...input,activityId:null,name:'  '}),/名称/)
  assert.throws(() => f.store.addSession({...input,endTime:new Date(f.now()+minute).toISOString()}),/未来/)
  assert.throws(() => f.store.addSession({...input,endTime:new Date(2026,10,9,8).toISOString()}),/结束时间/)
  assert.deepEqual(f.store.snapshot(),before)
  assert.equal(fs.readFileSync(f.file,'utf8'),disk)
})

test('manual entry write failure rolls back visits and ID allocation, then a retry persists and reloads', t => {
  const f = fixture(t)
  f.store.start('A')
  f.advance(10)
  f.store.end()
  const id = f.store.data.activities[0].id
  const before = f.store.snapshot()
  const input = {activityId:id,startTime:new Date(2026,10,9,8).toISOString(),endTime:new Date(2026,10,9,8,30).toISOString()}
  const write = f.store.write
  f.store.write = () => { throw new Error('disk full') }
  assert.throws(() => f.store.addSession(input),/保存/)
  assert.deepEqual(f.store.snapshot(),before)
  f.store.write = write
  f.store.addSession(input)
  assert.equal(f.store.get(id).sessions[0].id,`${id}:1`)
  const loaded = new ActivityStore(f.file,f.options)
  assert.deepEqual(loaded.snapshot(),f.store.snapshot())
})
