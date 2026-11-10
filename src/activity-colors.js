// Pick a persistent matter color with maximum perceptual separation from its peers.
const palette = ['#2679e8','#d58922','#a24dc1','#26965a','#cd4258','#219aa7','#a9a12a','#78523a']

function lab(hex) {
  const rgb = [1,3,5].map(index => parseInt(hex.slice(index,index+2),16)/255)
    .map(value => value<=.04045 ? value/12.92 : ((value+.055)/1.055)**2.4)
  const xyz = [
    (rgb[0]*.4124+rgb[1]*.3576+rgb[2]*.1805)/.95047,
    rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722,
    (rgb[0]*.0193+rgb[1]*.1192+rgb[2]*.9505)/1.08883
  ].map(value => value>.008856 ? Math.cbrt(value) : 7.787*value+16/116)
  return [116*xyz[1]-16,500*(xyz[0]-xyz[1]),200*(xyz[1]-xyz[2])]
}

function colorDistance(first,second) {
  const a = lab(first)
  const b = lab(second)
  return Math.hypot(...a.map((value,index) => value-b[index]))
}

function chooseMatterColor(existing) {
  const colors = existing.filter(color => /^#[\da-f]{6}$/i.test(color)).map(color => color.toLowerCase())
  if (!colors.length) return palette[0]
  const counts = palette.map(color => colors.filter(existing => existing===color).length)
  const minimum = Math.min(...counts)
  const candidates = palette.filter((color,index) => counts[index]===minimum)
  return candidates.reduce((best,color) => {
    const peers = colors.filter(existing => existing!==color)
    const separation = peers.length ? Math.min(...peers.map(existing => colorDistance(color,existing))) : 0
    return separation>best.separation ? {color,separation} : best
  },{color:candidates[0],separation:-1}).color
}

module.exports = { palette, chooseMatterColor, colorDistance }
