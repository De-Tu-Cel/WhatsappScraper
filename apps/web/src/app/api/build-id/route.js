import { readBuildId } from '@/lib/buildId'

// The build id of the CURRENTLY running server — VersionWatcher.jsx compares
// it against the one its page was rendered with to detect a deploy that
// happened after the page was opened, and reloads.
export const dynamic = 'force-dynamic'

export async function GET() {
  return Response.json({ buildId: readBuildId() }, {
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'CDN-Cache-Control': 'no-store',
      Pragma: 'no-cache',
    },
  })
}
