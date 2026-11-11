window.FloatodoIcons = {
  create(name) {
    const paths = {
      trash:'M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7',
      plus:'M12 5v14M5 12h14',
      return:'M9 5L4 10l5 5M4 10h10a5 5 0 0 1 0 10h-2',
      close:'M6 6l12 12M18 6L6 18',
      check:'M5 12l4 4L19 6',
      pin:'M8 3h8M9 3v5l-3 4v2h12v-2l-3-4V3M12 14v7',
      minus:'M5 12h14',
      list:'M9 6h11M9 12h11M9 18h11M3 6h1M3 12h1M3 18h1',
      timer:'M12 8v5l3 2M9 2h6M12 2v3M20 5l-2 2M20 13a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
      timeline:'M5 3v18M5 6h4M5 12h4M5 18h4M13 5h7M13 11h7M13 17h7',
      play:'M8 5l11 7-11 7z',
      flag:'M5 21V3M5 4c5-5 9 5 14 0v10c-5 5-9-5-14 0',
      calendar:'M4 5h16v16H4zM8 3v4M16 3v4M4 10h16M8 14h2M14 14h2',
      sliders:'M4 7h16M4 17h16M8 4v6M16 14v6',
      power:'M12 3v9M6 5a9 9 0 1 0 12 0'
    }
    if (!Object.hasOwn(paths, name)) throw new Error(`Unknown UI icon: ${name}`)
    const svg = document.createElementNS('http://www.w3.org/2000/svg','svg')
    for (const [key,value] of Object.entries({viewBox:'0 0 24 24',width:'14',height:'14',fill:'none',stroke:'currentColor','stroke-width':'1.6','stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true'})) svg.setAttribute(key,value)
    svg.classList.add('ui-icon')
    const path = document.createElementNS('http://www.w3.org/2000/svg','path')
    path.setAttribute('d',paths[name])
    svg.append(path)
    return svg
  },
  markup(name) { return this.create(name).outerHTML }
}

document.querySelectorAll('[data-icon]').forEach(element => {
  element.replaceChildren(window.FloatodoIcons.create(element.dataset.icon))
})
