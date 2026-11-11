// Visual QA uses an isolated profile and saves reviewable screenshots and layout metrics.
const fs = require('fs')
const os = require('os')
const path = require('path')
const assert = require('node:assert/strict')

if (!process.versions.electron) {
  const {spawnSync} = require('child_process')
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),'floatodo-design-profile-'))
  const output = process.env.FLOATODO_DESIGN_QA_DIR || path.join(os.tmpdir(),'floattodo-design-qa')
  fs.mkdirSync(output,{recursive:true})
  try {
    const env = {...process.env,FLOATODO_DESIGN_PROFILE:directory,FLOATODO_DESIGN_QA_DIR:output}
    delete env.ELECTRON_RUN_AS_NODE
    const result = spawnSync(require('electron'),[__filename],{env,encoding:'utf8',timeout:90000,windowsHide:true})
    process.stdout.write(result.stdout || '')
    if(result.status!==0) throw new Error(result.stderr || result.error?.message || `Electron exit ${result.status}`)
    console.log('Design QA artifacts: '+output)
  } finally {
    fs.rmSync(directory,{recursive:true,force:true,maxRetries:5,retryDelay:200})
  }
} else {
  const {app,BrowserWindow,dialog,session} = require('electron')
  const {ActivityStore} = require('../src/activity-store')
  const {localDate} = require('../src/activity-time')
  dialog.showMessageBox = async ()=>({response:1})
  app.commandLine.appendSwitch('force-device-scale-factor','1')
  app.commandLine.appendSwitch('disable-renderer-backgrounding')
  app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
  app.setName('FloatodoDesignQA')
  app.setPath('userData',process.env.FLOATODO_DESIGN_PROFILE)
  const directory = process.env.FLOATODO_DESIGN_PROFILE
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate()-1)
  const day = localDate(yesterday)
  const today = localDate()
  const at = time=>+new Date(`${day}T${time}:00`)
  let now = at('09:00')
  const store = new ActivityStore(path.join(directory,'activity-log.json'),{now:()=>now})
  store.start('打磨 Floatodo 的每一个细节')
  const activityId = store.current().id
  store.setProgress(activityId,store.current().sessions[0].id,'整理反馈，完善悬浮窗与备注交互')
  now=at('09:35');store.start('阅读与设计研究')
  now=at('10:00');store.resume(activityId)
  store.setProgress(activityId,store.current().sessions.at(-1).id,'完成界面层级与布局检查')
  now=at('10:45');store.pause()
  now=at('11:00');store.start('写一份清晰的工作总结')
  now=at('11:20');store.end()
  store.remove(store.data.activities.find(item=>item.name==='写一份清晰的工作总结').id)
  fs.writeFileSync(path.join(directory,'todos.json'),JSON.stringify([
    {id:'first',text:'把今天最重要的事情做好',notes:'先梳理目标，再拆成可执行的步骤。\n完成后记录收获与下一步。',done:false,urgent:true,deadline:today},
    {id:'second',text:'读完收藏的设计文章并记下想法',notes:'留意信息层级、留白与阅读节奏。',done:false,urgent:false},
    {id:'third',text:'给自己留一点散步的时间',done:false,urgent:false},
    {id:'done',text:'整理工作桌与本周计划',notes:'给新的开始留出空间。',done:true,completedAt:today},
    {id:'trash',text:'暂时放下的想法',notes:'之后再回来看看。',done:false,deletedAt:new Date().toISOString()}
  ]),'utf8')
  fs.writeFileSync(path.join(directory,'config.json'),JSON.stringify({backgroundTransparency:0}),'utf8')
  require('../src/main')
  const delay = milliseconds=>new Promise(resolve=>setTimeout(resolve,milliseconds))
  async function until(predicate) {
    for(let count=0;count<120;count++) {if(await predicate()) return;await delay(30)}
    throw new Error('Timed out waiting for design QA UI')
  }
  app.whenReady().then(async()=>{
    session.defaultSession.webRequest.onBeforeRequest((details,callback)=>callback({cancel:/^https?:/.test(details.url)}))
    const window = BrowserWindow.getAllWindows()[0]
    window.webContents.setBackgroundThrottling(false)
    window.show()
    const evaluate = code=>window.webContents.executeJavaScript(code,true)
    const click = id=>evaluate(`document.getElementById(${JSON.stringify(id)}).click()`)
    const page = name=>evaluate(`document.querySelector('[data-page="${name}"]').click()`)
    const output = process.env.FLOATODO_DESIGN_QA_DIR
    const report = []
    async function capture(name) {
      await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
      window.webContents.invalidate()
      await delay(300)
      const metrics = await evaluate(`(()=>{
        const visible=element=>element&&element.getClientRects().length&&getComputedStyle(element).visibility!=='hidden';
        const describe=element=>{
          const r=element.getBoundingClientRect();
          return {id:element.id||element.className,left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height,scrollWidth:element.scrollWidth,scrollHeight:element.scrollHeight,clientWidth:element.clientWidth,clientHeight:element.clientHeight};
        };
        return {viewport:{width:innerWidth,height:innerHeight},document:{width:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight},
          elements:[...document.querySelectorAll('.titlebar,.module-tabs,.module-page,.app-tools,.todo-toolbar,#todoComposer,.todo-notes-panel,#activityEditor,.editor-buttons')].filter(visible).map(describe),
          chrome:[...document.querySelectorAll('.titlebar button,.module-tabs button,.app-tools button')].filter(visible).map(describe)};
      })()`)
      report.push({name,...metrics})
      fs.writeFileSync(path.join(output,'layout-report.json'),JSON.stringify(report,null,2),'utf8')
      fs.writeFileSync(path.join(output,name+'.png'),(await window.webContents.capturePage()).toPNG())
      assert.ok(metrics.document.width<=metrics.viewport.width+1,`${name}: document horizontal overflow`)
      assert.ok(metrics.document.height<=metrics.viewport.height+1,`${name}: document vertical overflow (pages must scroll internally)`)
      for(const element of metrics.chrome) {
        assert.ok(element.left>=-1&&element.top>=-1&&element.right<=metrics.viewport.width+1&&element.bottom<=metrics.viewport.height+1,`${name}: chrome outside viewport ${JSON.stringify(element)}`)
      }
      for(const element of metrics.elements.filter(item=>String(item.id).startsWith('page-'))) {
        assert.ok(element.scrollWidth<=element.clientWidth+1,`${name}: active page horizontal overflow`)
      }
      console.log('PASS design snapshot '+name)
    }
    await until(async()=>!window.webContents.isLoading()&&await evaluate("Boolean(document.querySelector('#todoList [data-id=first]'))"))
    const resumed = await evaluate(`window.api.activityCommand(${JSON.stringify({type:'resume',payload:{id:activityId},requestId:'design-qa-resume'})})`)
    assert.equal(resumed.ok,true)
    for(const [width,height] of [[320,480],[270,360],[400,600]]) {
      window.setSize(width,height)
      await delay(200)
      const size=width+'x'+height
      await page('todos')
      await capture(size+'-todos')
      await evaluate("document.querySelector('[data-id=first] .todo-notes-toggle').click()")
      await capture(size+'-notes')
      await evaluate("document.querySelector('[data-id=first] .todo-notes-toggle').click()")
      await click('newTodoBtn')
      await evaluate("document.getElementById('todoInput').value='为明天留一个小小的计划';document.getElementById('todoNotes').value='写下具体的一步，让行动更轻松。\\n备注支持多行记录。'")
      await capture(size+'-composer')
      await evaluate("document.getElementById('page-todos').scrollTop=document.getElementById('page-todos').scrollHeight;document.getElementById('todoComposer').scrollTop=document.getElementById('todoComposer').scrollHeight")
      await capture(size+'-composer-bottom')
      assert.equal(await evaluate("(()=>{const b=document.getElementById('createTodoBtn').getBoundingClientRect(),f=document.getElementById('todoComposer').getBoundingClientRect();return b.top>=f.top-1&&b.bottom<=f.bottom+1})()"),true,size+': create action must be reachable inside composer')
      await click('cancelTodoBtn')
      await evaluate("document.getElementById('page-todos').scrollTop=0")
      await page('current')
      await capture(size+'-current')
      await page('timeline')
      await evaluate(`document.getElementById('timelineDate').value=${JSON.stringify(day)};document.getElementById('timelineDate').dispatchEvent(new Event('change'))`)
      await until(()=>evaluate("document.querySelectorAll('.timeline-item').length>=3"))
      await capture(size+'-timeline')
      await click('addActivity')
      await until(()=>evaluate("document.getElementById('activityEditor').open"))
      await capture(size+'-modal')
      const modalBounds=await evaluate("(()=>{const d=document.getElementById('activityEditor').getBoundingClientRect(),b=document.querySelector('.editor-buttons').getBoundingClientRect();return {left:d.left,right:d.right,top:d.top,bottom:d.bottom,buttonsBottom:b.bottom}})()")
      assert.ok(modalBounds.left>=-1&&modalBounds.right<=width+1&&modalBounds.top>=-1&&modalBounds.bottom<=height+1&&modalBounds.buttonsBottom<=height+1,size+': modal outside viewport')
      await click('cancelEditor')
      await click('todoTrashBtn')
      await until(()=>evaluate("!document.getElementById('page-trash').hidden"))
      await capture(size+'-recycle')
      await click('trashBack')
    }
    console.log('PASS design QA: 24 snapshots with viewport, page overflow, chrome and modal bounds checks')
    app.quit()
  }).catch(error=>{console.error(error.stack);process.exit(1)})
}
