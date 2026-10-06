import { forward } from '../_forward'
export const dynamic = 'force-dynamic'

export async function GET(request) {
  return forward(request, '/summary')
}
