import { useState } from 'react'
import { Minus, Plus, Scan } from 'lucide-react'
import * as P from '@/lib/paths'
import { bytes } from '@/lib/format'
import { useT } from '@/lib/i18n'

export function ImagePreview({ path, size }: { path: string; size: number }) {
  const t = useT()
  const [zoom, setZoom] = useState<number | 'fit'>('fit')
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null)
  const [stamp] = useState(() => Date.now())
  return (
    <div className="image-preview">
      <div className="image-stage">
        <img
          src={`${P.fileUrl(path)}?t=${stamp}`}
          alt={P.basename(path)}
          draggable={false}
          onLoad={(e) => setDims({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
          style={zoom === 'fit' ? { maxWidth: '100%', maxHeight: '100%' } : { width: dims ? dims.w * zoom : undefined }}
        />
      </div>
      <div className="image-bar">
        <span className="muted">
          {dims ? `${dims.w} × ${dims.h} px · ` : ''}
          {bytes(size)}
        </span>
        <span className="grow" />
        <button className="icon-btn sm" data-tip={t('Zoom out')} onClick={() => setZoom((z) => Math.max(0.1, (z === 'fit' ? 1 : z) / 1.25))}>
          <Minus size={14} />
        </button>
        <button className="btn btn-sm btn-ghost" onClick={() => setZoom(zoom === 'fit' ? 1 : 'fit')}>
          {zoom === 'fit' ? t('Fit') : `${Math.round(zoom * 100)}%`}
        </button>
        <button className="icon-btn sm" data-tip={t('Zoom in')} onClick={() => setZoom((z) => Math.min(16, (z === 'fit' ? 1 : z) * 1.25))}>
          <Plus size={14} />
        </button>
        <button className="icon-btn sm" data-tip={t('Actual size')} onClick={() => setZoom(1)}>
          <Scan size={14} />
        </button>
      </div>
    </div>
  )
}
