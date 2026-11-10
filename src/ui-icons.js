window.FloatodoIcons = {
  create(name) {
    const paths = {
      trash:'M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7',
      plus:'M12 5v14M5 12h14',
      return:'M9 5L4 10l5 5M4 10h10a5 5 0 0 1 0 10h-2',
      close:'M6 6l12 12M18 6L6 18'
    }
    const svg = document.createElementNS('http://www.w3.org/2000/svg','svg')
    for (const [key,value] of Object.entries({viewBox:'0 0 24 24',width:'14',height:'14',fill:'none',stroke:'currentColor','stroke-width':'1.6','stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true'})) svg.setAttribute(key,value)
    svg.classList.add('ui-icon')
    const path = document.createElementNS('http://www.w3.org/2000/svg','path')
    path.setAttribute('d',paths[name])
    svg.append(path)
    return svg
  }
}
