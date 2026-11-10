const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { ActivityStore } = require('../src/activity-store')
const { duration, dayBounds, localDate } = require('../src/activity-time')
const { humanDuration, heatLevel } = require('../src/activity-time')
const { timelineEntries } = require('../src/activity-time')
const { validateDocument } = require('../src/activity-store')

const minute = 60000
test('natural duration wording handles seconds, hours and empty records', () => {
  assert.equal(humanDuration(81000), '1 分 21 秒')
  assert.equal(humanDuration(0), '0 秒')
  assert.equal(humanDuration(3600000), '1 小时')
  assert.equal(humanDuration(3661000), '1 小时 1 分 1 秒')
})

test('duration heat bands have stable boundaries at 15, 30 and 60 minutes', () => {
  assert.equal(heatLevel(0), 1)
  assert.equal(heatLevel(15 * minute - 1), 1)
  assert.equal(heatLevel(15 * minute), 2)
  assert.equal(heatLevel(30 * minute), 3)
  assert.equal(heatLevel(60 * minute), 4)
})
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'floatodo-test-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  let time = new Date(2026, 10, 9, 9).getTime()
  const file = path.join(directory, 'activity-log.json')
  const options = { now: () => time }
  return { store: new ActivityStore(file, options), file, options,
    advance: minutes => { time += minutes * minute }, now: () => time }
}

test('A: starting B pauses A at the same timestamp, preserves todo link', t => {
  const f = fixture(t)
  f.store.start('A', 'todo-1')
  f.advance(30)
  f.store.start('B')
  const [a, b] = f.store.snapshot().activities
  assert.equal(a.status, 'paused')
  assert.equal(a.endTime, null)
  assert.equal(a.segments[0].end, b.startTime)
  assert.equal(duration(a, f.now()), 30 * minute)
  assert.equal(a.todoId, 'todo-1')
  assert.equal(b.status, 'running')
})

test('B: pause and resume exclude the twenty minute pause', t => {
  const f = fixture(t)
  f.store.start('A'); f.advance(20); f.store.pause(); f.advance(20)
  assert.equal(duration(f.store.paused()[0], f.now()), 20 * minute)
  f.store.resume(); f.advance(20); f.store.end()
  assert.equal(duration(f.store.snapshot().activities[0], f.now()), 40 * minute)
  assert.equal(f.store.snapshot().activities.length, 1)
})

test('switching a paused activity excludes all paused time', t => {
  const f = fixture(t)
  f.store.start('A'); f.advance(20); f.store.pause(); f.advance(40); f.store.start('B')
  assert.equal(duration(f.store.snapshot().activities[0], f.now()), 20 * minute)
})

test('E: crash recovery stops at checkpoint and never counts offline hours', t => {
  const f = fixture(t)
  f.store.start('A'); f.advance(0.5); f.store.checkpoint(); f.advance(720)
  const recovered = new ActivityStore(f.file, f.options)
  assert.equal(recovered.paused()[0].status, 'paused')
  assert.equal(recovered.paused()[0].pauseReason, 'interrupted')
  assert.equal(duration(recovered.paused()[0], f.now()), 0.5 * minute)
  recovered.resume(); f.advance(1); recovered.end()
  assert.equal(duration(recovered.snapshot().activities[0], f.now()), 1.5 * minute)
})

test('normal quit pause is retained on restart', t => {
  const f = fixture(t)
  f.store.start('A'); f.advance(1); f.store.pause('quit'); f.advance(600)
  const restored = new ActivityStore(f.file, f.options)
  assert.equal(restored.paused()[0].pauseReason, 'quit')
  assert.equal(duration(restored.paused()[0], f.now()), minute)
})

test('F: lock and sleep pause idempotently and never resume automatically', t => {
  for (const reason of ['lock', 'sleep']) {
    const f = fixture(t)
    f.store.start('A'); f.advance(10); f.store.pause(reason); f.store.pause(reason); f.advance(90)
    assert.equal(f.store.paused()[0].status, 'paused')
    assert.equal(duration(f.store.paused()[0], f.now()), 10 * minute)
  }
})

test('H: midnight splits daily duration while retaining a single record', t => {
  const f = fixture(t)
  f.advance(14 * 60 + 30); f.store.start('A'); f.advance(60); f.store.end()
  const a = f.store.snapshot().activities[0]
  assert.equal(duration(a, f.now()), 60 * minute)
  assert.equal(duration(a, f.now(), dayBounds('2026-11-09')), 30 * minute)
  assert.equal(duration(a, f.now(), dayBounds('2026-11-10')), 30 * minute)
  assert.equal(f.store.snapshot().activities.length, 1)
})

test('cross-midnight pauses are allocated by actual running segments', t => {
  const f = fixture(t)
  f.advance(14 * 60 + 30); f.store.start('A'); f.advance(20); f.store.pause(); f.advance(20)
  f.store.resume(); f.advance(20); f.store.end()
  const a = f.store.snapshot().activities[0]
  assert.equal(duration(a, f.now(), dayBounds('2026-11-09')), 20 * minute)
  assert.equal(duration(a, f.now(), dayBounds('2026-11-10')), 20 * minute)
})

test('manual insertion, editing segments, overlap rejection and deletion', t => {
  const f = fixture(t)
  const iso = offset => new Date(f.now() + offset * minute).toISOString()
  const base = {name:'reading', startTime:iso(-120), endTime:iso(-60), segments:[{start:iso(-120),end:iso(-100)},{start:iso(-80),end:iso(-60)}]}
  f.store.edit(base)
  const a = f.store.snapshot().activities[0]
  assert.equal(duration(a, f.now()), 40 * minute)
  assert.throws(() => f.store.edit({...base, name:'overlap'}), /冲突/)
  // A separate activity can occupy a real pause without double-counting time.
  f.store.edit({name:'break task',startTime:iso(-100),endTime:iso(-80),segments:[{start:iso(-100),end:iso(-80)}]})
  f.store.edit({...a, name:'renamed'})
  assert.equal(f.store.snapshot().activities[0].name, 'renamed')
  f.store.remove(a.id)
  assert.equal(f.store.snapshot().activities.length, 1)
})

test('invalid and future times, blank names and overlapping segments are rejected', t => {
  const f = fixture(t)
  assert.throws(() => f.store.start('   '), /名称/)
  const start = new Date(f.now()-minute).toISOString()
  const end = new Date(f.now()).toISOString()
  assert.throws(() => f.store.edit({name:'x',startTime:end,endTime:start,segments:[]}), /结束时间/)
  assert.throws(() => f.store.edit({name:'x',startTime:start,endTime:new Date(f.now()+minute).toISOString(),segments:[]}), /未来/)
  assert.throws(() => f.store.edit({name:'x',startTime:start,endTime:end,segments:[{start,end},{start,end}]}), /时间段/)
  f.store.start('A')
  assert.throws(() => f.store.edit(f.store.current()), /先暂停/)
})

test('disk write failure rolls back memory and preserves disk data', t => {
  const f = fixture(t)
  f.store.start('A')
  const before = fs.readFileSync(f.file, 'utf8')
  f.store.write = () => { throw Object.assign(new Error('disk full'), {code:'ENOSPC'}) }
  assert.throws(() => f.store.start('B'), /保存活动失败/)
  assert.equal(f.store.current().name, 'A')
  assert.equal(fs.readFileSync(f.file, 'utf8'), before)
})

test('corrupt JSON restores backup and preserves damaged original', t => {
  const f = fixture(t)
  f.store.start('A'); f.advance(1); f.store.pause()
  fs.writeFileSync(f.file, '{broken')
  const restored = new ActivityStore(f.file, f.options)
  assert.equal(restored.paused()[0].name, 'A')
  assert.match(restored.notice, /意外中断/)
  assert.match(restored.notice, /文件损坏/)
  assert.ok(fs.readdirSync(path.dirname(f.file)).some(name => name.includes('.damaged-')))
})

test('unreadable data and unknown versions are protected from overwrites', t => {
  for (const source of ['broken', JSON.stringify({version:3,activities:[]})]) {
    const f = fixture(t)
    fs.writeFileSync(f.file, source)
    const restored = new ActivityStore(f.file, f.options)
    assert.ok(restored.error)
    assert.throws(() => restored.start('A'))
    assert.equal(fs.readFileSync(f.file, 'utf8'), source)
  }
})

test('clock gaps and backward clock changes stop at last reliable checkpoint', t => {
  for (const jump of [120, -10]) {
    const f = fixture(t)
    f.store.start('A'); f.advance(.5); f.store.checkpoint(); f.advance(jump); f.store.checkpoint()
    assert.equal(f.store.paused()[0].status, 'paused')
    assert.equal(f.store.paused()[0].pauseReason, 'clock-gap')
    // Evaluate after the recorded endpoint, even when system time went backward.
    assert.equal(duration(f.store.paused()[0], Infinity), .5 * minute)
  }
})

test('idle time is counted, while checkpoint writes occur only on request', t => {
  const f = fixture(t)
  f.store.start('reading')
  const before = fs.readFileSync(f.file, 'utf8')
  f.advance(1)
  assert.equal(duration(f.store.current(), f.now()), minute)
  assert.equal(fs.readFileSync(f.file, 'utf8'), before)
})

test('closed intervals keep their measured duration when the clock moves backward', t => {
  const f = fixture(t)
  f.store.start('A'); f.advance(10); f.store.end()
  const completed = f.store.snapshot().activities[0]
  f.advance(-60)
  assert.equal(duration(completed, f.now()), 10 * minute)
})

test('daily bounds use the process local time zone and validate calendar dates', () => {
  const start = new Date(2026, 10, 9)
  assert.equal(dayBounds('2026-11-09')[0], +start)
  assert.equal(localDate(start), '2026-11-09')
  assert.throws(() => dayBounds('2026-02-30'))
})

test('DST transition days use 23/25 hour local boundaries', () => {
  const { execFileSync } = require('child_process')
  const output = execFileSync(process.execPath, ['-e', `const {dayBounds}=require('./src/activity-time'); console.log(JSON.stringify(['2026-03-08','2026-11-01'].map(day=>{const [a,b]=dayBounds(day);return (b-a)/3600000})))`],
    {cwd:path.join(__dirname, '..'),env:{...process.env,TZ:'America/New_York'},encoding:'utf8'})
  assert.deepEqual(JSON.parse(output), [23,25])
})

test('activity storage leaves existing todo and archive files untouched', t => {
  const f = fixture(t)
  const todoFile = path.join(path.dirname(f.file), 'todos.json')
  fs.writeFileSync(todoFile, '[{"text":"original"}]')
  f.store.start('A'); f.advance(1); f.store.end()
  assert.equal(fs.readFileSync(todoFile, 'utf8'), '[{"text":"original"}]')
})

test('interleaving A/B/C keeps one foreground and preserves unrelated paused matters', t => {
  const f = fixture(t)
  f.store.start('A'); const a = f.store.current().id
  f.advance(20); f.store.start('B'); const b = f.store.current().id
  f.advance(15); f.store.start('C'); const c = f.store.current().id
  f.advance(5)
  const bBefore = structuredClone(f.store.get(b))
  f.store.resume(a)
  assert.equal(f.store.current().id, a)
  assert.equal(f.store.get(c).status, 'paused')
  assert.deepEqual(f.store.get(b), bBefore)
  assert.equal(f.store.paused().length, 2)
  assert.equal(f.store.get(c).segments.at(-1).end, f.store.get(a).segments.at(-1).start)
  f.advance(10); f.store.end(a)
  assert.equal(f.store.current(), undefined)
  assert.equal(f.store.get(a).status, 'completed')
  assert.equal(f.store.get(a).segments.length, 2)
  assert.equal(duration(f.store.get(a), f.now()), 30 * minute)
  assert.equal(duration(f.store.get(b), f.now()), 15 * minute)
  assert.equal(duration(f.store.get(c), f.now()), 5 * minute)
  assert.equal(f.store.snapshot().activities.length, 3)
})

test('same-name new matters receive distinct IDs and ending a background does not stop foreground', t => {
  const f = fixture(t)
  f.store.start('same'); const a = f.store.current().id
  f.advance(10); f.store.start('same'); const b = f.store.current().id
  assert.notEqual(a, b)
  const foreground = structuredClone(f.store.current())
  f.advance(20); f.store.end(a)
  assert.deepEqual(f.store.current(), foreground)
  assert.equal(f.store.get(a).status, 'completed')
  assert.equal(duration(f.store.get(a), f.now()), 10 * minute)
})

test('repeated resumes use one stable ID and separate foreground segments', t => {
  const f = fixture(t)
  f.store.start('A'); const id = f.store.current().id
  for (let index = 0; index < 5; index++) {
    f.advance(1); f.store.pause(); f.advance(10); f.store.resume(id)
  }
  const before = fs.readFileSync(f.file, 'utf8')
  f.store.resume(id)
  assert.equal(fs.readFileSync(f.file, 'utf8'), before)
  f.advance(1); f.store.end(id)
  assert.equal(f.store.snapshot().activities.length, 1)
  assert.equal(f.store.get(id).segments.length, 6)
  assert.equal(duration(f.store.get(id), f.now()), 6 * minute)
  assert.throws(() => f.store.resume(id), /可继续/)
})

test('ambiguous, missing and failed resume requests leave all matters unchanged', t => {
  const f = fixture(t)
  f.store.start('A'); const a = f.store.current().id
  f.advance(1); f.store.start('B'); f.advance(1); f.store.pause()
  assert.throws(() => f.store.resume(), /请选择/)
  assert.throws(() => f.store.resume('missing'), /可继续/)
  const before = f.store.snapshot()
  f.store.write = () => { throw new Error('disk full') }
  assert.throws(() => f.store.resume(a), /保存活动失败/)
  assert.deepEqual(f.store.snapshot(), before)
})

test('lock/sleep/crash only pause foreground and retain every background ID and duration', t => {
  const f = fixture(t)
  f.store.start('A'); const a = f.store.current().id
  f.advance(10); f.store.start('B'); const b = f.store.current().id
  const backgroundBefore = structuredClone(f.store.get(a))
  f.advance(1); f.store.pause('lock')
  assert.equal(f.store.current(), undefined)
  assert.deepEqual(f.store.get(a), backgroundBefore)
  f.advance(10); f.store.resume(b); f.advance(.5); f.store.checkpoint(); f.advance(720)
  const recovered = new ActivityStore(f.file, f.options)
  assert.equal(recovered.current(), undefined)
  assert.equal(recovered.paused().length, 2)
  assert.deepEqual(recovered.get(a), backgroundBefore)
  assert.equal(recovered.get(b).pauseReason, 'interrupted')
  assert.equal(duration(recovered.get(b), f.now()), 1.5 * minute)
  recovered.resume(a)
  assert.equal(recovered.current().id, a)
  assert.equal(recovered.get(b).status, 'paused')
})

test('v1 migration backs up all history and paused records without changing IDs or time segments', t => {
  const f = fixture(t)
  f.store.start('complete'); f.advance(1); f.store.end()
  f.store.start('paused'); f.advance(1); f.store.pause()
  const legacy = f.store.snapshot()
  delete legacy.error; delete legacy.notice
  legacy.version = 1
  fs.writeFileSync(f.file, JSON.stringify(legacy))
  const migrated = new ActivityStore(f.file, f.options)
  assert.equal(migrated.error, null)
  assert.equal(migrated.data.version, 2)
  assert.deepEqual(migrated.data.activities, legacy.activities)
  assert.deepEqual(JSON.parse(fs.readFileSync(migrated.migrationBackup, 'utf8')), legacy)
  const before = fs.readFileSync(f.file, 'utf8')
  const again = new ActivityStore(f.file, f.options)
  assert.equal(again.migrationBackup, undefined)
  assert.equal(fs.readFileSync(f.file, 'utf8'), before)
})

test('v1 running migration cuts offline time at checkpoint and failed migration preserves original', t => {
  const f = fixture(t)
  f.store.start('A'); f.advance(.5); f.store.checkpoint()
  const legacy = structuredClone(f.store.data)
  legacy.version = 1
  const original = JSON.stringify(legacy)
  fs.writeFileSync(f.file, original)
  const failed = new ActivityStore(f.file, {...f.options,write:()=>{throw new Error('read only')}})
  assert.ok(failed.error)
  assert.equal(fs.readFileSync(f.file,'utf8'),original)
  assert.deepEqual(JSON.parse(fs.readFileSync(failed.migrationBackup,'utf8')),legacy)
  f.advance(600)
  const migrated = new ActivityStore(f.file,f.options)
  assert.equal(migrated.paused()[0].pauseReason,'interrupted')
  assert.equal(duration(migrated.paused()[0],f.now()),.5*minute)
})

test('two foregrounds and overlapping intervals are rejected while pause gaps remain available', t => {
  const f = fixture(t)
  f.store.start('A'); f.advance(10); f.store.start('B'); f.advance(5); f.store.pause()
  const before = f.store.snapshot()
  const data = structuredClone(f.store.data)
  data.activities[0].status='running'
  data.activities[0].segments.at(-1).end=null
  data.activities[1].status='running'
  data.activities[1].segments.at(-1).end=null
  assert.throws(()=>validateDocument(data), /前台/)
  const a = f.store.data.activities[0]
  const b = f.store.data.activities[1]
  assert.throws(()=>f.store.edit({...a,segments:[{start:a.startTime,end:b.segments[0].end}]}), /冲突/)
  assert.deepEqual(f.store.snapshot(),before)
})

test('timeline projects separate foreground slices linked to the same matter and splits midnight', t => {
  const f=fixture(t)
  f.advance(14*60+30); f.store.start('A'); const a=f.store.current().id
  f.advance(30); f.store.start('B'); f.advance(10); f.store.resume(a); f.advance(20); f.store.end(a)
  const entries=timelineEntries(f.store.data.activities,'2026-11-10',f.now())
  assert.deepEqual(entries.map(entry=>entry.name),['A','B'])
  assert.equal(entries[0].id,a)
  assert.equal(entries[0].entryKey,`${a}:1`)
  assert.equal(duration(entries[0],f.now(),dayBounds('2026-11-10')),20*minute)
  assert.equal(timelineEntries(f.store.data.activities,'2026-11-09',f.now()).length,1)
  assert.equal(duration(f.store.get(a),f.now()),50*minute)
  assert.equal(f.store.get(a).segments.length,2)
})

test('many paused matters survive restart with no foreground selected implicitly', t => {
  const f=fixture(t)
  for(let index=0;index<50;index++) {
    f.store.start(`item-${index}`)
    f.advance(1)
  }
  f.store.pause('sleep')
  const ids=f.store.data.activities.map(activity=>activity.id)
  const restored=new ActivityStore(f.file,f.options)
  assert.equal(restored.current(),undefined)
  assert.equal(restored.paused().length,50)
  assert.deepEqual(restored.data.activities.map(activity=>activity.id),ids)
  assert.equal(restored.data.activities.reduce((sum,activity)=>sum+duration(activity,f.now()),0),50*minute)
})
