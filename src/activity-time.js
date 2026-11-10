// Shared timestamp calculations. Local midnight boundaries also handle DST days.
;(function (root) {
  const {sessionsOf} = typeof module !== 'undefined' ? require('./activity-sessions') : root.ActivitySessions
  function localDate(date = new Date()) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  }

  function dayBounds(day) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error('日期格式无效')
    const start = new Date(`${day}T00:00:00`)
    if (!Number.isFinite(+start) || localDate(start) !== day) throw new Error('日期无效')
    const end = new Date(start)
    end.setDate(end.getDate() + 1)
    return [+start, +end]
  }

  function duration(activity, now = Date.now(), bounds = [-Infinity, Infinity]) {
    return activity.segments.reduce((total, segment) => {
      const start = Math.max(Date.parse(segment.start), bounds[0])
      const end = Math.min(segment.end === null ? now : Date.parse(segment.end), bounds[1])
      return total + Math.max(0, end - start)
    }, 0)
  }

  function clock(milliseconds) {
    const seconds = Math.max(0, Math.floor(milliseconds / 1000))
    return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
      .map(value => String(value).padStart(2, '0')).join(':')
  }

  function humanDuration(milliseconds) {
    const total = Math.max(0, Math.floor(milliseconds / 1000))
    const parts = []
    const hours = Math.floor(total / 3600)
    const minutes = Math.floor(total / 60) % 60
    const seconds = total % 60
    if (hours) parts.push(`${hours} 小时`)
    if (minutes) parts.push(`${minutes} 分`)
    if (seconds || !parts.length) parts.push(`${seconds} 秒`)
    return parts.join(' ')
  }

  function heatLevel(milliseconds) {
    const minutes = milliseconds / 60000
    if (minutes >= 60) return 4
    if (minutes >= 30) return 3
    if (minutes >= 15) return 2
    return 1
  }

  function timelineEntries(activities, day, now = Date.now()) {
    const bounds = dayBounds(day)
    return activities.flatMap(activity => {
      const sessions = sessionsOf(activity)
      return sessions.map((session, index) => ({
        ...activity,
        entryKey: session.id, sessionId: session.id, sessionIndex:index,
        progress:session.progress, originalStartTime:session.startTime, originalEndTime:session.endTime,
        startTime: new Date(Math.max(Date.parse(session.startTime),bounds[0])).toISOString(),
        endTime: session.endTime === null && now < bounds[1] ? null
          : new Date(Math.min(session.endTime === null ? now : Date.parse(session.endTime),bounds[1])).toISOString(),
        segments: session.segments,
        status: session.endTime === null ? 'running' : activity.status === 'paused' && index === sessions.length - 1 ? 'paused' : 'completed'
      }))
    }).filter(entry => {
      const start = Date.parse(entry.originalStartTime)
      return duration(entry,now,bounds)>0 || (start>=bounds[0]&&start<bounds[1]&&(!entry.segments.length || entry.segments.every(segment=>segment.end===segment.start) || entry.endTime===null))
    })
      .sort((a, b) => (day === localDate(new Date(now)) ? -1 : 1) * (Date.parse(a.startTime) - Date.parse(b.startTime)))
  }

  function matterColor(id, preferred) {
    const colors = ['#2679e8', '#279f8d', '#9566c1', '#ca8b35', '#c36689', '#6476b9']
    let hash = 0
    for (const character of id) hash = (Math.imul(hash, 31) + character.charCodeAt(0)) >>> 0
    const hex = /^#[\da-f]{6}$/i.test(preferred) ? preferred : colors[hash % colors.length]
    const rgb = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16)).join(',')
    return { hex, rgb }
  }

  function durationOpacity(milliseconds) {
    return [.3, .5, .75, 1][heatLevel(milliseconds) - 1]
  }

  function untrackedGaps(activities, day, now = Date.now()) {
    const bounds = dayBounds(day)
    const intervals = activities.flatMap(activity => activity.segments.map(segment => ({
      start: Math.max(Date.parse(segment.start), bounds[0]),
      end: Math.min(segment.end === null ? now : Date.parse(segment.end), bounds[1])
    }))).filter(interval => interval.end > interval.start).sort((a, b) => a.start - b.start)
    const merged = []
    for (const interval of intervals) {
      const last = merged.at(-1)
      if (last && interval.start <= last.end) last.end = Math.max(last.end, interval.end)
      else merged.push({ ...interval })
    }
    const gaps = []
    for (let index = 1; index < merged.length; index++) {
      const start = merged[index - 1].end
      const end = merged[index].start
      if (end - start >= 1000) gaps.push({
        startTime: new Date(start).toISOString(),
        endTime: new Date(end).toISOString(),
        gap: true
      })
    }
    const last = merged.at(-1)
    if (day === localDate(new Date(now)) && last && now - last.end >= 1000) gaps.push({
      startTime: new Date(last.end).toISOString(),
      endTime: new Date(now).toISOString(),
      gap: true,
      trailing: true
    })
    return gaps
  }

  function sessionDays(activity, now = Date.now()) {
    const days = new Set()
    for (const session of sessionsOf(activity)) {
      if (!session.segments.length) days.add(localDate(new Date(session.startTime)))
      for (const interval of session.segments) {
        const start = Date.parse(interval.start)
        const end = interval.end === null ? now : Date.parse(interval.end)
        const date = new Date(start)
        date.setHours(0, 0, 0, 0)
        do {
          days.add(localDate(date))
          date.setDate(date.getDate() + 1)
        } while (+date < end)
      }
    }
    return [...days].sort()
  }

  const api = { localDate, dayBounds, duration, clock, humanDuration, heatLevel, timelineEntries,
    matterColor, durationOpacity, untrackedGaps, sessionDays }
  if (typeof module !== 'undefined') module.exports = api
  else root.ActivityTime = api
})(typeof window !== 'undefined' ? window : globalThis)
