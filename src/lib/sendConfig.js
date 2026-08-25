// Send config — loaded from localStorage, shared across batch/campaign/db sends

export const DEFAULT_SEND_CONFIG = {
  batchSize:  [3, 8],   // [min, max] messages per batch before a long break
  msgDelay:   [25, 55], // [min, max] seconds between consecutive messages
  batchDelay: [3, 8],   // [min, max] minutes between batches
  // newContactsLimit is enforced by the backend per-instance (5 warmup / 12 normal)
}

export function loadSendConfig() {
  if (typeof window === 'undefined') return { ...DEFAULT_SEND_CONFIG }
  try {
    const raw = localStorage.getItem('send_config')
    return raw ? { ...DEFAULT_SEND_CONFIG, ...JSON.parse(raw) } : { ...DEFAULT_SEND_CONFIG }
  } catch { return { ...DEFAULT_SEND_CONFIG } }
}

export function saveSendConfig(cfg) {
  if (typeof window === 'undefined') return
  localStorage.setItem('send_config', JSON.stringify({ ...DEFAULT_SEND_CONFIG, ...cfg }))
}

// Random integer in [min, max] inclusive
export function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

// Pick a random delay in ms from a [min, max] seconds range
export function randMsgDelayMs(cfg) {
  return randInt(cfg.msgDelay[0], cfg.msgDelay[1]) * 1000
}

// Pick a random batch break in ms from a [min, max] minutes range
export function randBatchBreakMs(cfg) {
  return randInt(cfg.batchDelay[0], cfg.batchDelay[1]) * 60 * 1000
}

// Pick a random batch size from [min, max]
export function randBatchSize(cfg) {
  return randInt(cfg.batchSize[0], cfg.batchSize[1])
}
