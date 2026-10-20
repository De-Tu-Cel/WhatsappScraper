import { forward, notFound, ID_RE } from '../_backend'

export async function GET(request, { params }) {
  const { id } = await params
  if (!ID_RE.test(id)) return notFound()
  return forward(request, `/api/evaluaciones/${id}`)
}

export async function PUT(request, { params }) {
  const { id } = await params
  if (!ID_RE.test(id)) return notFound()
  return forward(request, `/api/evaluaciones/${id}`, { method: 'PUT', body: await request.text() })
}
