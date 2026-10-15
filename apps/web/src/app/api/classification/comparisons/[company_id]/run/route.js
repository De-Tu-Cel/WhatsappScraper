import { forward } from '../../_forward'
export const dynamic = 'force-dynamic'

export async function POST(request, { params }) {
  const { company_id } = await params
  const number = new URL(request.url).searchParams.get('number')
  return forward(request, `/${encodeURIComponent(company_id)}/run${number ? `?number=${encodeURIComponent(number)}` : ''}`, 'POST')
}
