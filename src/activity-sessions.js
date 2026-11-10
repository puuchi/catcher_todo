// A session is one foreground visit. Its intervals may be corrected independently.
;(function (root) {
  function sessionsOf(activity) {
    if (Array.isArray(activity.sessions)) return activity.sessions
    const intervals = activity.segments || []
    if (!intervals.length) return [{
      id: `${activity.id}:0`,
      startTime: activity.startTime,
      endTime: activity.endTime || activity.startTime,
      progress: '',
      segments: []
    }]
    return intervals.map((interval, index) => ({
      id: `${activity.id}:${index}`, startTime: interval.start, endTime: interval.end,
      progress: '', segments: [{ ...interval }]
    }))
  }

  function ensureSessions(activity) {
    if (!Array.isArray(activity.sessions)) activity.sessions = sessionsOf(activity)
    if (!Number.isInteger(activity.nextSessionIndex)) {
      activity.nextSessionIndex = activity.sessions.reduce((next, session) => {
        const index = Number(session.id.slice(activity.id.length + 1))
        return Number.isInteger(index) ? Math.max(next, index + 1) : next
      }, activity.sessions.length)
    }
    return activity.sessions
  }

  function appendSession(activity, time) {
    ensureSessions(activity)
    const session = {
      id: `${activity.id}:${activity.nextSessionIndex++}`,
      startTime: new Date(time).toISOString(), endTime: null, progress: '',
      segments: [{start: new Date(time).toISOString(), end: null}]
    }
    activity.sessions.push(session)
    syncSegments(activity)
    return session
  }

  function syncSegments(activity) {
    activity.segments = activity.sessions.flatMap(session => session.segments.map(interval => ({...interval})))
      .sort((a, b) => Date.parse(a.start) - Date.parse(b.start))
  }

  function resizeSessionSegments(session, startTime, endTime) {
    const start = Date.parse(startTime)
    const end = Date.parse(endTime)
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) throw new Error('结束时间必须晚于或等于开始时间')
    if (start === Date.parse(session.startTime) && end === Date.parse(session.endTime)) {
      return session.segments.map(segment => ({ ...segment }))
    }
    const shift = start-Date.parse(session.startTime)
    if (shift === end-Date.parse(session.endTime)) return session.segments.map(segment => ({
      start: new Date(Date.parse(segment.start)+shift).toISOString(),
      end: new Date(Date.parse(segment.end)+shift).toISOString()
    }))
    return session.segments.map((segment, index) => {
      const firstBoundary = index === 0 && Date.parse(segment.start) === Date.parse(session.startTime)
      const lastBoundary = index === session.segments.length - 1 && Date.parse(segment.end) === Date.parse(session.endTime)
      return {
        start: Math.max(start, firstBoundary ? start : Date.parse(segment.start)),
        end: Math.min(end, lastBoundary ? end : Date.parse(segment.end))
      }
    }).filter(segment => segment.end > segment.start).map(segment => ({
      start: new Date(segment.start).toISOString(), end: new Date(segment.end).toISOString()
    }))
  }

  const api = { sessionsOf, ensureSessions, appendSession, syncSegments, resizeSessionSegments }
  if (typeof module !== 'undefined') module.exports = api
  else root.ActivitySessions = api
})(typeof window !== 'undefined' ? window : globalThis)
