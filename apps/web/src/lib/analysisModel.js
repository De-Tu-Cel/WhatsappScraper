// La identidad histórica sale del resultado guardado, nunca del modelo actual.
export function analysisModelInfo(result, en = false, method) {
  const rules = { kind: 'rules', label: en ? 'No AI call' : 'Sin llamada a IA', provider: en ? 'Fixed rules' : 'Reglas fijas' }
  if (method === 'timing' || result?.analysis_origin === 'rules') return rules
  if (typeof result?.model === 'string' && result.model.trim()) {
    const provider = { openai: 'OpenAI', anthropic: 'Anthropic', deepseek: 'DeepSeek' }[result.provider]
    return { kind: 'recorded', label: result.model.trim(), provider: provider || (en ? 'Saved model' : 'Modelo registrado'), requested: result.model_requested }
  }
  return (result?.trace || []).some(step => /sin consultar al modelo|no model call/i.test(step.paso || ''))
    ? rules : { kind: 'unknown', label: en ? 'Model not recorded' : 'Modelo no registrado', provider: en ? 'Historical result' : 'Resultado histórico' }
}
