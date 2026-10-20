/**
 * Liga pública de la evaluación para el prospecto: app.detucel.com/evaluacion/<token>.
 * No pide sesión (la abre el cliente desde WhatsApp); el token es aleatorio y largo.
 */
import { forward, TOKEN_RE } from '../../api/evaluaciones/_backend'

export async function GET(request, { params }) {
  const { token } = await params
  if (!TOKEN_RE.test(token)) {
    return new Response('Evaluación no encontrada', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } })
  }
  return forward(request, `/api/evaluaciones/publica/${token}`)
}
