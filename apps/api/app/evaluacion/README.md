# Evaluación del canal WhatsApp (one-pager)

La página que se le manda al prospecto: así atiende hoy su WhatsApp, nivel 1-5, lo que ya
funciona, 3 áreas de oportunidad con su marca en la conversación real, y cómo se vería con
De Tu Cel. Se arma desde la conversación y el análisis de la app; una persona la revisa y la
manda por liga (`app.detucel.com/evaluacion/<token>`).

```
plantilla.html                 diseño, estilos y lógica (sin datos) — del equipo de diseño
config/base.json               textos y marca De Tu Cel
config/industrias/<giro>.json  ventajas, demo, dashboard y referencias del giro (gaseras, restaurantes)
assets/                        logos De Tu Cel, Nano, fuente y referencias
generador.py                   puerto de generar.js: base + giro + cliente → HTML de un solo archivo
armador.py                     capa "cliente" desde la app: conversación, nivel, hallazgos (IA + reglas)
formato.py                     WhatsApp → HTML seguro, fechas y horas en español
../api/evaluaciones.py         endpoints (borrador, edición, vista previa, liga pública)
```

En la app: **Análisis** → botón ✨ de la empresa o del número → *Generar evaluación* → revisar y
corregir → *Copiar liga*.

## Reglas que no hay que romper

- **El texto de la conversación nunca entra como HTML.** La plantilla pinta los mensajes con
  `innerHTML`; `formato.whatsapp_a_html` escapa todo y solo convierte `*negritas*`, `_cursivas_`,
  `~tachado~` y saltos de línea. Las llaves se escriben como entidades (un `{{…}}` de terceros no es
  una variable del generador).
- **Las ediciones no aceptan HTML** y respetan los topes de `armador.LIMITES`: con ellos la hoja
  carta cabe aun con todos los textos en el máximo (medido en navegador, 2026-10-20). Si se suben,
  volver a medir: la plantilla avisa en la consola "[Evaluación] El contenido excede la hoja carta".
- **Lo que afirma un hecho se verifica contra lo medido** (`verificar_datos`): "Sin respuesta",
  "Pedido por llamada" y "N h de espera" se quitan si la conversación no los respalda.
- El logo se descarga solo de URLs públicas (sin IPs internas ni redirecciones) y los subidos se
  validan por su contenido. El scraper a veces toma el logo de un cliente o socio de la empresa:
  el borrador siempre pide revisarlo.

## Cambiar el diseño o los textos

Se cambian `plantilla.html` o los JSON igual que en la herramienta original (`generar.js`). Luego:

1. Copiar `diesgas.json`/`ejemplo-restaurante.json` y sus assets a `tests/fixtures/evaluacion/`.
2. `node generar.js config/clientes/diesgas.json config/clientes/ejemplo-restaurante.json` en la
   carpeta original y poner las nuevas huellas (sha256, 16 caracteres) en
   `tests/test_evaluacion.py::NODE_SHA256`. Esa prueba exige que el generador en Python produzca
   el mismo HTML byte por byte.

## Nuevo giro

Copiar `config/industrias/gaseras.json` (ver el README original: ventajas con `id`, demo con
`pin`, dashboard y referencias). `armador.industria_de` detecta gaseras; para otros giros la app
pide elegir la plantilla.
