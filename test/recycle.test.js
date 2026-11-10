const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const {ActivityStore,validateDocument} = require('../src/activity-store')
const {duration,matterColor} = require('../src/activity-time')
const {palette,chooseMatterColor,colorDistance} = require('../src/activity-colors')

const minute = 60000
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),'floatodo-recycle-'))
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}))
  let time = +new Date(2026,10,9,9)
  const file = path.join(directory,'activity-log.json')
  const options = {now:()=>time}
  return {store:new ActivityStore(file,options),file,options,advance:minutes=>{time+=minutes*minute},now:()=>time}
}

test('whole matter deletion is recoverable, stops its clock and preserves IDs, notes, todo link and color',t=>{
  const f = fixture(t)
  f.store.start('A','todo-A')
  const a = f.store.current().id
  f.store.setProgress(a,f.store.get(a).sessions[0].id,'初稿')
  f.advance(10)
  f.store.remove(a)
  assert.equal(f.store.get(a),undefined)
  const entry = f.store.data.trash[0]
  assert.equal(entry.kind,'matter')
  assert.equal(entry.activity.status,'paused')
  assert.equal(duration(entry.activity,f.now()),10*minute)
  f.advance(30)
  f.store.start('B')
  const b = structuredClone(f.store.current())
  f.store.restoreTrash(entry.id)
  const restored = f.store.get(a)
  assert.equal(restored.status,'paused')
  assert.equal(restored.todoId,'todo-A')
  assert.equal(restored.sessions[0].progress,'初稿')
  assert.equal(restored.color,entry.activity.color)
  assert.equal(duration(restored,f.now()),10*minute)
  assert.deepEqual(f.store.current(),b)
  assert.equal(f.store.data.trash.length,0)
})

test('deleting one visit recycles only that visit and restoring merges it into the stable matter',t=>{
  const f = fixture(t)
  f.store.start('A')
  const id = f.store.current().id
  f.advance(10);f.store.pause();f.advance(5);f.store.resume(id);f.advance(5);f.store.pause()
  const original = structuredClone(f.store.get(id))
  f.store.deleteSession(id,original.sessions[0].id)
  assert.equal(f.store.get(id).sessions.length,1)
  assert.equal(f.store.data.trash[0].kind,'session')
  f.store.updateMatter(id,{name:'修改后的事项',status:'paused'})
  f.store.restoreTrash(f.store.data.trash[0].id)
  assert.equal(f.store.get(id).name,'修改后的事项')
  assert.deepEqual(f.store.get(id).sessions,original.sessions)
  assert.equal(f.store.get(id).color,original.color)
  f.store.resume(id)
  assert.equal(f.store.get(id).sessions.at(-1).id,`${id}:2`)
})

test('deleting a historical visit while its matter runs preserves its active foreground segment',t=>{
  const f = fixture(t)
  f.store.start('A')
  const id = f.store.current().id
  f.advance(5);f.store.pause();f.advance(5);f.store.resume(id)
  const open = structuredClone(f.store.current().sessions[1])
  f.store.deleteSession(id,f.store.current().sessions[0].id)
  assert.equal(f.store.current().id,id)
  assert.deepEqual(f.store.current().sessions[0],open)
  f.store.restoreTrash(f.store.data.trash[0].id)
  assert.deepEqual(f.store.current().sessions.at(-1),open)
})

test('active visit deletion archives its measured interval and restoration stays paused',t=>{
  const f = fixture(t)
  f.store.start('A')
  const id = f.store.current().id
  f.advance(3)
  f.store.deleteSession(id,f.store.current().sessions[0].id)
  f.advance(120)
  f.store.restoreTrash(f.store.data.trash[0].id)
  assert.equal(f.store.get(id).status,'paused')
  assert.equal(duration(f.store.get(id),f.now()),3*minute)
})

test('a single visit and its subsequently deleted parent restore correctly in either order',t=>{
  for (const order of ['session-first','matter-first']) {
    const f = fixture(t)
    f.store.start('A');const id=f.store.current().id
    f.advance(5);f.store.pause();f.advance(5);f.store.resume(id);f.advance(5);f.store.end(id)
    const original=structuredClone(f.store.get(id))
    f.store.deleteSession(id,original.sessions[0].id)
    f.store.remove(id)
    const session=f.store.data.trash.find(entry=>entry.kind==='session').id
    const matter=f.store.data.trash.find(entry=>entry.kind==='matter').id
    const ids=order==='session-first'?[session,matter]:[matter,session]
    for (const entry of ids) f.store.restoreTrash(entry)
    assert.deepEqual(f.store.get(id).sessions,original.sessions)
    assert.equal(f.store.get(id).status,'completed')
    assert.equal(f.store.data.activities.length,1)
    assert.equal(f.store.data.trash.length,0)
  }
})

test('restore conflicts and write failures leave live data and recycle entries intact',t=>{
  const f=fixture(t)
  f.store.start('A');const a=f.store.current().id
  f.advance(10);f.store.end();f.store.remove(a)
  const entry=f.store.data.trash[0].id
  const interval={start:new Date(2026,10,9,9).toISOString(),end:new Date(2026,10,9,9,5).toISOString()}
  f.store.addSession({name:'占用原时段',startTime:interval.start,endTime:interval.end})
  const before=f.store.snapshot()
  assert.throws(()=>f.store.restoreTrash(entry),/冲突/)
  assert.deepEqual(f.store.snapshot(),before)
  const write=f.store.write
  f.store.write=()=>{throw new Error('disk full')}
  assert.throws(()=>f.store.deleteTrash(entry),/保存/)
  assert.deepEqual(f.store.snapshot(),before)
  f.store.write=write
  const live=structuredClone(f.store.data.activities)
  f.store.deleteTrash(entry)
  assert.deepEqual(f.store.data.activities,live)
  assert.throws(()=>f.store.restoreTrash(entry),/不存在/)
})

test('trash and colors survive restart, while unsupported trash versions are protected',t=>{
  const f=fixture(t)
  f.store.start('A');const id=f.store.current().id
  f.advance(3);f.store.remove(id)
  const reloaded=new ActivityStore(f.file,f.options)
  assert.deepEqual(reloaded.snapshot(),f.store.snapshot())
  const data=JSON.parse(fs.readFileSync(f.file,'utf8'))
  data.trash[0].kind='future-kind'
  fs.writeFileSync(f.file,JSON.stringify(data))
  const disk=fs.readFileSync(f.file,'utf8')
  const future=new ActivityStore(f.file,f.options)
  assert.match(future.error,/版本/)
  assert.equal(fs.readFileSync(f.file,'utf8'),disk)
})

test('palette prefers different hues without collisions until its distinct colors are used',()=>{
  const colors=[]
  for(let index=0;index<palette.length;index++) colors.push(chooseMatterColor(colors))
  assert.equal(new Set(colors).size,palette.length)
  for(let first=0;first<colors.length;first++) for(let second=first+1;second<colors.length;second++) assert.ok(colorDistance(colors[first],colors[second])>=30)
  assert.equal(colors[0],'#2679e8')
  assert.equal(colors[1],'#d58922')
  const more=[...colors]
  for(let index=0;index<palette.length;index++) more.push(chooseMatterColor(more))
  assert.ok(palette.every(color=>more.filter(item=>item===color).length===2))
})

test('legacy color assignment creates a safety backup and keeps existing intervals and IDs',t=>{
  const f=fixture(t)
  for(const name of ['A','B','C']){f.store.start(name);f.advance(1)}
  f.store.pause()
  const legacy=structuredClone(f.store.data)
  for(const activity of legacy.activities) delete activity.color
  fs.writeFileSync(f.file,JSON.stringify(legacy))
  const migrated=new ActivityStore(f.file,f.options)
  assert.deepEqual(JSON.parse(fs.readFileSync(migrated.migrationBackup,'utf8')),legacy)
  assert.equal(new Set(migrated.data.activities.map(activity=>activity.color)).size,3)
  for(const [index,activity] of migrated.data.activities.entries()){
    assert.equal(activity.id,legacy.activities[index].id)
    assert.deepEqual(activity.sessions,legacy.activities[index].sessions)
    assert.equal(matterColor(activity.id,activity.color).hex,activity.color)
  }
  validateDocument(migrated.data)
})
