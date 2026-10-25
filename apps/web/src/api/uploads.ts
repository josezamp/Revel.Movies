import type { MediaAsset } from './client'

/** XHR exposes bytes sent; fetch does not provide upload progress in TV browsers. */
export function uploadMediaWithProgress(eventId: string, file: File, signal: AbortSignal,
  onProgress: (loaded: number, total: number | null) => void): Promise<MediaAsset> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    const abort = () => xhr.abort()
    const finish = () => signal.removeEventListener('abort', abort)
    if (signal.aborted) { reject(new DOMException('Subida cancelada', 'AbortError')); return }
    xhr.open('POST', `/api/events/${encodeURIComponent(eventId)}/media`)
    xhr.responseType = 'json'
    xhr.upload.onprogress = event => onProgress(event.loaded, event.lengthComputable ? event.total : null)
    xhr.onload = () => {
      finish()
      if (xhr.status >= 200 && xhr.status < 300 && xhr.response?.id) resolve(xhr.response as MediaAsset)
      else reject(new Error(uploadError(xhr.response?.error) || `No se pudo subir el archivo (${xhr.status}).`))
    }
    xhr.onerror = () => { finish(); reject(new Error('Se interrumpió la conexión durante la subida.')) }
    xhr.onabort = () => { finish(); reject(new DOMException('Subida cancelada', 'AbortError')) }
    signal.addEventListener('abort', abort, { once: true })
    const form = new FormData()
    form.append('file', file)
    xhr.send(form)
  })
}

function uploadError(message: string | undefined): string | undefined {
  if (!message) return undefined
  const messages: Record<string, string> = {
    'Event was not found.': 'El evento ya no está disponible.',
    'The uploaded file is empty.': 'El archivo está vacío.',
    'Unsupported media format. Allowed: MP4, JPG, JPEG, PNG, WEBP and GIF.': 'Formato no compatible. Usá MP4, JPG, JPEG, PNG, WEBP o GIF.',
    'The file contents do not match the selected media format.': 'El contenido del archivo no coincide con su formato.',
    'Media name cannot exceed 200 characters.': 'El nombre del archivo no puede superar los 200 caracteres.',
    'File name cannot exceed 260 characters.': 'El nombre completo del archivo no puede superar los 260 caracteres.',
  }
  return messages[message] ?? message
}
