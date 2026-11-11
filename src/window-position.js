function clampBounds(bounds, displays) {
  if (!bounds || ![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite) || bounds.width <= 0 || bounds.height <= 0) {
    throw new Error('Invalid saved window bounds: ' + JSON.stringify(bounds))
  }
  if (!displays.length) throw new Error('No available display work areas')
  const areas = displays.map(display => display.workArea)
  const intersection = area => Math.max(0, Math.min(bounds.x + bounds.width, area.x + area.width) - Math.max(bounds.x, area.x)) * Math.max(0, Math.min(bounds.y + bounds.height, area.y + area.height) - Math.max(bounds.y, area.y))
  const distance = area => Math.hypot(Math.max(area.x - bounds.x, 0, bounds.x - area.x - area.width), Math.max(area.y - bounds.y, 0, bounds.y - area.y - area.height))
  const area = areas.reduce((best, candidate) => intersection(candidate) > intersection(best) || (intersection(candidate) === intersection(best) && distance(candidate) < distance(best)) ? candidate : best)
  const width = Math.min(Math.round(bounds.width), area.width)
  const height = Math.min(Math.round(bounds.height), area.height)
  return {
    x: Math.round(Math.max(area.x, Math.min(bounds.x, area.x + area.width - width))),
    y: Math.round(Math.max(area.y, Math.min(bounds.y, area.y + area.height - height))),
    width,
    height
  }
}

module.exports = { clampBounds }
