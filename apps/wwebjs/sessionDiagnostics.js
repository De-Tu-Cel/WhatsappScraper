// Evidence from a status transition; never infer a ban from a generic logout.
const os = require('node:os')
const crypto = require('node:crypto')

function statusEvidence({ id, session, activity, memory, now = Date.now }) {
  let usage = null
  try { usage = memory()[id] || null } catch (_) {}
  let browserProcess = null
  try {
    const proc = session?.client?.pupBrowser?.process?.()
    if (proc) browserProcess = { pid: proc.pid, exit_code: proc.exitCode, signal: proc.signalCode }
  } catch (_) {}
  let recent = null
  try { recent = activity.snapshot(id) } catch (_) {}
  return {
    event_id: crypto.randomUUID(),
    captured_at: new Date(now()).toISOString(),
    session_memory: usage,
    browser_process: browserProcess,
    activity: recent,
    heartbeat_failures: session?.heartbeatFailStreak || 0,
    last_error: session?.lastDiagnosticError || null,
    service_memory_mb: Math.round(process.memoryUsage().rss / 1024 / 1024),
    host_available_memory_mb: Math.round(os.freemem() / 1024 / 1024),
    host_load_average: os.loadavg(),
  }
}

module.exports = { statusEvidence }
