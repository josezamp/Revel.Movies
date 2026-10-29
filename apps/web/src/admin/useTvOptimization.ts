import { useEffect, useRef, useState } from 'react'
import { getMediaOptimizations, optimizeMediaForTv, type MediaAsset, type MediaOptimization } from '../api/client'

export function useTvOptimization(eventId: string, media: MediaAsset[], onMediaChanged: () => Promise<void>) {
  const [available, setAvailable] = useState<boolean>()
  const [jobs, setJobs] = useState<MediaOptimization[]>([])
  const [error, setError] = useState('')
  const [requesting, setRequesting] = useState('')
  const requestRevision = useRef(0)
  const submitting = useRef(false)
  const mounted = useRef(true)
  const latest = useRef({ media, onMediaChanged })
  latest.current = { media, onMediaChanged }
  const mediaRevision = media.map(item => `${item.id}:${item.checksum}`).join(',')

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; requestRevision.current++ }
  }, [])

  useEffect(() => {
    let active = true
    let timer: ReturnType<typeof setTimeout>
    async function read() {
      const revision = ++requestRevision.current
      let delay = 3000
      try {
        const result = await getMediaOptimizations(eventId)
        if (!active || revision !== requestRevision.current) return
        setAvailable(result.available); setJobs(result.jobs); setError('')
        delay = result.available ? 3000 : 30000
        if (result.jobs.some(job => job.status === 'Completed' && job.resultMediaId &&
            !latest.current.media.some(item => item.id === job.resultMediaId)))
          await latest.current.onMediaChanged()
      } catch (cause) {
        if (active && revision === requestRevision.current)
          setError(cause instanceof Error ? cause.message : 'No se pudo consultar la optimización para TV.')
      } finally { if (active) timer = setTimeout(() => void read(), delay) }
    }
    if (eventId) void read()
    return () => { active = false; clearTimeout(timer); requestRevision.current++ }
  }, [eventId, mediaRevision])

  async function start(mediaId: string) {
    if (submitting.current) return
    submitting.current = true; requestRevision.current++; setRequesting(mediaId); setError('')
    try {
      const job = await optimizeMediaForTv(mediaId)
      if (mounted.current) setJobs(current => [...current.filter(item => item.mediaId !== mediaId), job])
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : 'No se pudo iniciar la optimización.')
    } finally { submitting.current = false; if (mounted.current) setRequesting('') }
  }

  return { available, jobs, error, requesting, start }
}
