function publicContactName(contact) {
  // verifiedName/pushname son públicos; name/shortName pertenecen a la agenda.
  for (const value of [contact?.verifiedName, contact?.pushname, contact?.notifyName]) {
    if (typeof value !== 'string') continue
    const name = value.replace(/\s+/g, ' ').trim().slice(0, 150)
    if (name && !['-', 'unknown', 'desconocido'].includes(name.toLowerCase())) return name
  }
  return ''
}

async function cachedContactName(client, jid, notifyName) {
  let timer
  try {
    const contact = await Promise.race([
      client.pupPage.evaluate(id => {
        const store = window.require('WAWebCollections').Contact
        const c = store.get(id) // Sólo caché: no find(), consultas ni verificaciones WA.
        return c ? { verifiedName: c.verifiedName, pushname: c.pushname } : null
      }, jid),
      new Promise(resolve => { timer = setTimeout(() => resolve(null), 1500) }),
    ])
    return publicContactName(contact) || publicContactName({ notifyName })
  } catch { return publicContactName({ notifyName }) }
  finally { clearTimeout(timer) }
}

module.exports = { publicContactName, cachedContactName }
