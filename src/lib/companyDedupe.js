// Dedup por company_id — una empresa con varios números de WhatsApp encontrados
// en el mismo scraping debe aparecer una sola vez en el selector de destinatarios
// (el envío real solo usa uno de sus números, y el cupo diario cuenta por empresa).
export function dedupeByCompany(rows) {
  const seen = new Set()
  return rows.filter(r => (seen.has(r.company_id) ? false : seen.add(r.company_id)))
}
