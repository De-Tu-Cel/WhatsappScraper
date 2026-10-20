import { forward, notFound, ID_RE } from '../../_backend'

// El PDF de lo guardado (dos hojas carta), para mandarlo como archivo.
export async function GET(request, { params }) {
  const { id } = await params
  if (!ID_RE.test(id)) return notFound()
  return forward(request, `/api/evaluaciones/${id}/pdf`)
}
