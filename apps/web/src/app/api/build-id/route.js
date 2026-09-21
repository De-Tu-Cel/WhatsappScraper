import { readFileSync } from 'fs'
import { join } from 'path'

// Next.js writes a fresh random BUILD_ID to .next/BUILD_ID on every `next
// build` — reading it here (server-side, always the CURRENTLY running
// build) gives VersionWatcher.jsx something to compare against the buildId
// the client loaded with (window.__NEXT_DATA__.buildId), so it can detect
// a deploy that happened after the page was opened and reload.
export async function GET() {
  try {
    const buildId = readFileSync(join(process.cwd(), '.next', 'BUILD_ID'), 'utf8').trim()
    return Response.json({ buildId }, { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return Response.json({ buildId: null }, { headers: { 'Cache-Control': 'no-store' } })
  }
}
