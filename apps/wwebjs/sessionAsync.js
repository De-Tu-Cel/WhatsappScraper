// Bound auxiliary browser calls. A timeout does not cancel or retry a send.
async function withTimeout(action, ms, label = 'Browser operation') {
  let timer
  try {
    return await Promise.race([
      Promise.resolve().then(action),
      new Promise((_, reject) => { timer = setTimeout(() => reject(Error(`${label} timed out`)), ms) }),
    ])
  } finally { clearTimeout(timer) }
}

module.exports = { withTimeout }
