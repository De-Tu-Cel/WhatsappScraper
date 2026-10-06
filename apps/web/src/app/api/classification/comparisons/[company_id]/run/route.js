import { forward } from '../../_forward'
export const dynamic = 'force-dynamic'

export async function POST(request, { params }) {
  const { company_id } = await params
  return forward(request, `/${company_id}/run`, 'POST')
}
