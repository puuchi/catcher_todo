;(function () {
  const button = document.getElementById('btnAppearance')
  const panel = document.getElementById('appearancePanel')
  const slider = document.getElementById('backgroundTransparency')
  const value = document.getElementById('transparencyValue')
  const status = document.getElementById('appearanceStatus')

  function preview(transparency) {
    slider.value = transparency
    value.textContent = `${transparency}%`
    document.documentElement.style.setProperty('--bg', `rgba(249, 248, 241, ${1 - transparency / 100})`)
    document.documentElement.style.setProperty('--wash-opacity', String((1 - transparency / 100) * 0.24))
  }

  function hidePanel() {
    panel.hidden = true
    button.setAttribute('aria-expanded', 'false')
  }

  button.addEventListener('click', () => {
    panel.hidden = !panel.hidden
    button.setAttribute('aria-expanded', String(!panel.hidden))
  })
  document.addEventListener('pointerdown', event => {
    if (!panel.hidden && !panel.contains(event.target) && !button.contains(event.target)) hidePanel()
  })
  panel.addEventListener('keydown', event => {
    if (event.key === 'Escape') { hidePanel(); button.focus() }
  })
  slider.addEventListener('input', () => { preview(Number(slider.value)); status.textContent = '' })
  slider.addEventListener('change', async () => {
    try {
      const result = await window.api.saveTransparency(Number(slider.value))
      status.textContent = result.ok ? '已保存' : result.error
    } catch { status.textContent = '保存失败，请稍后重试' }
  })
  window.api.getTransparency().then(transparency => {
    preview(transparency)
    slider.disabled = false
  }).catch(() => { status.textContent = '读取设置失败'; slider.disabled = false })
})()
