import { forward } from '../_forward'
export const dynamic = 'force-dynamic'

export async function GET(request, { params }) {
  const { company_id } = await params
  return forward(request, `/${company_id}`)
}
