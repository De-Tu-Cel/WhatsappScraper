"""Evaluación del canal WhatsApp (one-pager De Tu Cel) generada desde los datos de la app.

generador.py  porta generar.js: combina base + industria + cliente y produce el HTML.
armador.py    arma la capa "cliente" desde la base (empresa, conversación real, análisis).
"""
from app.evaluacion.generador import generar_evaluacion  # noqa: F401
