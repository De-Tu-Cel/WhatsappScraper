import { forward, notFound, ID_RE } from '../../_backend'

// La página con los cambios del editor SIN guardarlos (vista previa en vivo).
export async function POST(request, { params }) {
  const { id } = await params
  if (!ID_RE.test(id)) return notFound()
  return forward(request, `/api/evaluaciones/${id}/vista-previa`, { method: 'POST', body: await request.text() })
}
