import { forward } from './_backend'

export async function GET(request) {
  const companyId = request.nextUrl.searchParams.get('company_id') || ''
  return forward(request, `/api/evaluaciones?company_id=${encodeURIComponent(companyId)}`)
}

export async function POST(request) {
  return forward(request, '/api/evaluaciones', { method: 'POST', body: await request.text() })
}
