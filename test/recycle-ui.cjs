const fs = require('fs')
const os = require('os')
const path = require('path')
const assert = require('node:assert/strict')

if (!process.versions.electron) {
  const {spawnSync} = require('child_process')
  for (const scale of ['1','1.25','1.5']) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(),'floatodo-recycle-ui-'))
    try {
      const env = {...process.env,FLOATODO_TEST_DATA:directory,FLOATODO_TEST_SCALE:scale}
      delete env.ELECTRON_RUN_AS_NODE
      const result = spawnSync(require('electron'),[__filename],{env,encoding:'utf8',timeout:90000,windowsHide:true})
      process.stdout.write(result.stdout || '')
      if (result.status !== 0) throw new Error(result.stderr || result.error?.message || `Electron exit ${result.status}`)
    } finally {
      fs.rmSync(directory,{recursive:true,force:true,maxRetries:5,retryDelay:200})
    }
  }
} else {
  const {app,BrowserWindow,dialog,session} = require('electron')
  dialog.showMessageBox = async () => ({response:1})
  const {ActivityStore} = require('../src/activity-store')
  const {localDate} = require('../src/activity-time')
  const scale = process.env.FLOATODO_TEST_SCALE
  const directory = process.env.FLOATODO_TEST_DATA
  app.commandLine.appendSwitch('force-device-scale-factor',scale)
  app.commandLine.appendSwitch('disable-renderer-backgrounding')
  app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
  app.setPath('userData',directory)
  app.setName('FloatodoRecycleTest')
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate()-1)
  const day = localDate(yesterday)
  const at = time => +new Date(`${day}T${time}:00`)
  let now = at('09:00')
  const store = new ActivityStore(path.join(directory,'activity-log.json'),{now:()=>now})
  store.start('研究 Floatodo'); const a = store.current().id
  store.setProgress(a,store.current().sessions[0].id,'阅读源码与整理需求')
  now=at('09:20');store.start('制作简历');const b=store.current().id
  now=at('09:40');store.pause()
  now=at('09:50');store.resume(a)
  store.setProgress(a,store.current().sessions.at(-1).id,'实现交互细节')
  now=at('10:30');store.pause()
  now=at('10:40');store.start('智慧工地项目');const c=store.current().id
  now=at('11:00');store.end()
  const sessionId=store.get(a).sessions[0].id
  store.deleteSession(a,sessionId)
  store.remove(c)
  fs.writeFileSync(path.join(directory,'todos.json'),JSON.stringify([
    {id:'todo-live',text:'整理项目资料',done:false,urgent:false},
    {id:'todo-deleted',text:'待恢复的待办',done:false,deletedAt:new Date().toISOString()}
  ]))
  fs.writeFileSync(path.join(directory,'config.json'),JSON.stringify({backgroundTransparency:0}))
  require('../src/main')
  const delay = milliseconds=>new Promise(resolve=>setTimeout(resolve,milliseconds))
  app.whenReady().then(async()=>{
    session.defaultSession.webRequest.onBeforeRequest((details,callback)=>callback({cancel:/^https?:/.test(details.url)}))
    const window=BrowserWindow.getAllWindows()[0]
    window.webContents.setBackgroundThrottling(false)
    window.show()
    const evaluate=code=>window.webContents.executeJavaScript(code,true)
    const click=id=>evaluate(`document.getElementById(${JSON.stringify(id)}).click()`)
    const state=()=>evaluate('window.api.getActivities()')
    const command=(type,payload={})=>evaluate(`window.api.activityCommand(${JSON.stringify({type,payload,requestId:require('crypto').randomUUID()})})`)
    async function until(predicate) {
      for(let attempt=0;attempt<150;attempt++) {if(await predicate()) return;await delay(30)}
      throw new Error('Timed out waiting for recycle UI')
    }
    async function capture(name) {
      if(!process.env.FLOATODO_SCREENSHOT_DIR) return
      fs.mkdirSync(process.env.FLOATODO_SCREENSHOT_DIR,{recursive:true})
      await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
      window.webContents.invalidate()
      await delay(400)
      fs.writeFileSync(path.join(process.env.FLOATODO_SCREENSHOT_DIR,`${name}-${scale}x.png`),(await window.webContents.capturePage()).toPNG())
    }
    async function openTrash() {
      await click('todoTrashBtn')
      await until(()=>evaluate("!document.getElementById('page-trash').hidden&&document.querySelectorAll('.recycle-item').length>0"))
    }
    async function restore(kind) {
      await evaluate(`document.querySelector('.recycle-item[data-kind="${kind}"] .recycle-restore').click()`)
      await until(()=>evaluate(`!document.querySelector('.recycle-item[data-kind="${kind}"]')`))
    }
    await until(async()=>!window.webContents.isLoading()&&await evaluate("document.getElementById('backgroundCount').textContent==='(2)'"))
    window.setSize(320,480)
    await delay(200)
    for(const page of ['todos','current','timeline']) {
      await evaluate(`document.querySelector('[data-page="${page}"]').click()`)
      assert.equal(await evaluate("(()=>{const a=document.getElementById('btnAppearance').getBoundingClientRect(),b=document.getElementById('todoTrashBtn').getBoundingClientRect();return b.left>=a.right&&Math.abs((a.top+a.height/2)-(b.top+b.height/2))<1&&b.bottom<=innerHeight&&document.getElementById('todoTrashBtn').textContent.trim()===''})()"),true)
      await openTrash()
      assert.equal(await evaluate("document.getElementById('todoTrashBtn').getAttribute('aria-pressed')"),'true')
      await click('trashBack')
      assert.equal(await evaluate(`document.getElementById('page-${page}').hidden`),false)
    }
    await evaluate(`document.getElementById('timelineDate').value=${JSON.stringify(day)};document.getElementById('timelineDate').dispatchEvent(new Event('change'))`)
    await openTrash()
    assert.deepEqual(await evaluate("[...document.querySelectorAll('.recycle-item')].map(row=>row.dataset.kind).sort()"),['matter','session','todo'])
    await capture('15-recycle-all')
    await evaluate("document.getElementById('trashFilter').value='matter';document.getElementById('trashFilter').dispatchEvent(new Event('change'))")
    assert.equal(await evaluate("document.querySelectorAll('.recycle-item').length"),1)
    await evaluate("document.getElementById('trashFilter').value='all';document.getElementById('trashFilter').dispatchEvent(new Event('change'))")
    await restore('todo')
    await restore('session')
    await restore('matter')
    assert.equal((await state()).activities.find(item=>item.id===a).sessions[0].id,sessionId)
    assert.equal((await state()).activities.find(item=>item.id===c).color,store.data.trash.find(item=>item.kind==='matter').activity.color)
    await click('trashBack')
    await until(()=>evaluate("document.querySelectorAll('.timeline-item').length===4"))
    assert.equal(await evaluate("document.querySelector('.timeline-return-mark svg')!==null&&!document.getElementById('timelineList').textContent.includes('继续')"),true)
    assert.equal(await evaluate("[...document.querySelectorAll('.gap-add')].every(button=>button.textContent.trim()===''&&button.querySelector('svg')&&button.getAttribute('aria-label'))"),true)
    for(const width of [320,269]) {
      window.setSize(width,479)
      await delay(200)
      assert.equal(await evaluate("document.documentElement.scrollWidth<=innerWidth"),true)
      assert.equal(await evaluate("(()=>{const a=document.querySelector('.gap-add').getBoundingClientRect(),b=document.querySelector('.timeline-menu-toggle').getBoundingClientRect();return Math.abs((a.left+a.width/2)-(b.left+b.width/2))<1})()"),true)
      await capture(`16-timeline-${width}`)
      await evaluate(`document.querySelector('[data-activity-id="${a}"].timeline-item').click()`)
      assert.equal(await evaluate("(()=>{const h=document.querySelector('.focus-summary-heading').getBoundingClientRect(),s=document.getElementById('focusSummaryStats').getBoundingClientRect(),f=document.querySelector('.app-tools').getBoundingClientRect();return s.top>=h.bottom&&s.bottom<=f.top&&document.getElementById('focusSummaryText').textContent==='研究 Floatodo'&&document.getElementById('focusSummaryStats').textContent.includes('2 次')})()"),true)
      await capture(`17-focus-${width}`)
      await click('clearFocus')
    }
    await evaluate(`document.querySelector('[data-activity-id="${a}"] .timeline-menu-toggle').click()`)
    await click('timelineMenuEdit')
    assert.equal(await evaluate("document.querySelector('.session-intervals')===null&&document.getElementById('segmentDetails')===null"),true)
    await capture('18-details')
    await click('deleteMatter')
    assert.ok((await state()).activities.some(item=>item.id===a))
    await click('deleteMatter')
    await until(async()=>!(await state()).activities.some(item=>item.id===a))
    await openTrash();await restore('matter');await click('trashBack')
    await click('addActivity')
    await evaluate(`document.getElementById('recordActivity').value=${JSON.stringify(c)};document.getElementById('recordActivity').dispatchEvent(new Event('change'))`)
    await click('deleteSelectedMatter');await click('deleteSelectedMatter')
    await until(async()=>!(await state()).activities.some(item=>item.id===c))
    await until(()=>evaluate("!document.getElementById('activityEditor').open"))
    await openTrash()
    const before=(await state()).trash.length
    await evaluate("document.querySelector('.trash-delete').click()")
    assert.equal((await state()).trash.length,before)
    assert.equal(await evaluate("document.querySelector('.trash-delete.confirming').getAttribute('aria-label')"),'确认永久删除')
    await evaluate("document.querySelector('.trash-delete.confirming').click()")
    await until(async()=>(await state()).trash.length===before-1)
    await click('trashBack')
    assert.equal((await command('start',{name:'前台恢复测试'})).ok,true)
    const active=(await state()).activities.find(item=>item.status==='running')
    await command('remove',{id:active.id})
    await openTrash();await restore('matter')
    assert.equal((await state()).activities.find(item=>item.id===active.id).status,'paused')
    await click('trashBack')
    await evaluate("document.querySelector('[data-page=current]').click()")
    await capture('19-current')
    await evaluate("document.querySelector('[data-page=todos]').click()")
    await until(()=>evaluate("document.getElementById('todoList').textContent.includes('待恢复的待办')"))
    await capture('20-todos')
    const colors=(await state()).activities.map(item=>[item.id,item.color])
    await window.webContents.reload()
    await until(async()=>!window.webContents.isLoading()&&await evaluate("Boolean(window.api&&document.getElementById('backgroundCount').textContent!=='0')"))
    assert.deepEqual((await state()).activities.map(item=>[item.id,item.color]),colors)
    // Empty matters remain manageable even after their last visit is removed.
    const lastVisit=(await state()).activities.find(item=>item.id===b).sessions[0]
    await command('session-delete',{activityId:b,sessionId:lastVisit.id})
    await evaluate("document.querySelector('[data-page=timeline]').click();document.getElementById('addActivity').click()")
    await evaluate(`document.getElementById('recordActivity').value=${JSON.stringify(b)};document.getElementById('recordActivity').dispatchEvent(new Event('change'))`)
    await click('deleteSelectedMatter');await click('deleteSelectedMatter')
    await until(async()=>!(await state()).activities.some(item=>item.id===b))
    await until(()=>evaluate("!document.getElementById('activityEditor').open"))
    await openTrash();await restore('matter');await restore('session');await click('trashBack')
    assert.equal((await state()).activities.find(item=>item.id===b).sessions[0].id,lastVisit.id)
    // A restore must report conflicts and retain the archived data for correction.
    await command('session-add',{name:'冲突恢复测试',startTime:new Date(at('12:00')).toISOString(),endTime:new Date(at('12:10')).toISOString()})
    const conflict=(await state()).activities.find(item=>item.name==='冲突恢复测试')
    await command('remove',{id:conflict.id})
    await command('session-add',{name:'占用时间',startTime:new Date(at('12:00')).toISOString(),endTime:new Date(at('12:05')).toISOString()})
    await openTrash()
    await evaluate("document.querySelector('.activity-restore').click()")
    await until(()=>evaluate("document.getElementById('trashMessage').textContent.includes('冲突')"))
    assert.equal((await state()).trash.length,1)
    assert.equal(await evaluate("document.querySelectorAll('.recycle-item').length"),1)
    console.log(`PASS recycle UI at ${scale}x: global icon, all types, filters, restore, two-click permanent delete, matter deletion, stable colors, 269/320px alignment, focus and symbols`)
    app.quit()
  }).catch(error=>{console.error(error.stack);process.exit(1)})
}
