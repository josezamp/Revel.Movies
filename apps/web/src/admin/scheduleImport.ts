export const MAX_SCHEDULE_IMPORT_BYTES = 1024 * 1024

function readScheduleImport(text: string): { json: string; value: Record<string, unknown> } {
  if (new TextEncoder().encode(text).byteLength > MAX_SCHEDULE_IMPORT_BYTES)
    throw new Error('El JSON supera el límite de 1 MB. Dividí la programación en archivos más pequeños.')
  let source = text.trim()
  if (!source) throw new Error('Pegá el JSON o elegí un archivo para continuar.')
  const fenced = /^```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n```$/i.exec(source)
  if (fenced) source = fenced[1].trim()
  let value: unknown
  try { value = JSON.parse(source) }
  catch { throw new Error('El texto no es un JSON válido. Copiá la respuesta completa, sin explicaciones fuera del JSON, y revisá las comas y las comillas.') }
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('La programación debe ser un objeto JSON con sus escenas y horarios. Usá el contexto para ChatGPT de este evento.')
  return { json: source, value: value as Record<string, unknown> }
}

export const parseScheduleImport = (text: string): Record<string, unknown> => readScheduleImport(text).value

// Preserve duplicate properties for the server's strict validator. JSON.parse alone would erase them.
export const scheduleImportJson = (text: string): string => readScheduleImport(text).json

// These are wall-clock values in the supplied event time zone, never browser-local dates.
export function importLocalDate(value: string): string {
  const [year, month, day] = value.slice(0, 10).split('-')
  return `${day}/${month}/${year}`
}

export function downloadScheduleContext(prompt: string, eventId: string) {
  const url = URL.createObjectURL(new Blob([prompt], { type: 'text/plain;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `revel-contexto-${eventId}.txt`
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
