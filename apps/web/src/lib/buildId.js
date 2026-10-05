import { readFileSync } from 'fs'
import { join } from 'path'

// Server-side only. Next.js writes a fresh random BUILD_ID to .next/BUILD_ID on
// every `next build` — the id of the code this server is running.
export function readBuildId() {
  try {
    return readFileSync(join(process.cwd(), '.next', 'BUILD_ID'), 'utf8').trim() || null
  } catch {
    return null
  }
}
