import { forward, notFound, ID_RE } from '../../_backend'

export async function GET(request, { params }) {
  const { id } = await params
  if (!ID_RE.test(id)) return notFound()
  const descargar = request.nextUrl.searchParams.get('descargar') === '1' ? '?descargar=true' : ''
  return forward(request, `/api/evaluaciones/${id}/html${descargar}`)
}
