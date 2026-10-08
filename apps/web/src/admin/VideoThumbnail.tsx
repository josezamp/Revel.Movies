import { useState } from 'react'

export function VideoThumbnail({ src }: { src: string }) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')

  return (
    <div className="media-video-preview">
      {status !== 'error' && (
        <video
          className={`media-preview${status === 'ready' ? ' is-ready' : ''}`}
          src={src}
          preload="metadata"
          muted
          playsInline
          aria-hidden="true"
          onLoadedMetadata={(event) => {
            const video = event.currentTarget
            // Skip the opening frame while keeping the seek inside short clips.
            video.currentTime = Number.isFinite(video.duration) && video.duration > 0
              ? Math.min(1, video.duration / 2)
              : 0
          }}
          onLoadedData={(event) => {
            if (!event.currentTarget.seeking) setStatus('ready')
          }}
          onSeeked={() => setStatus('ready')}
          onError={() => setStatus('error')}
        />
      )}
      {status !== 'ready' && (
        <span className="media-preview-placeholder">
          {status === 'error' ? 'Video preview unavailable' : 'Loading preview…'}
        </span>
      )}
    </div>
  )
}
