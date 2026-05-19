import { useEffect, useRef } from 'react'

/**
 * fixed-position layer behind everything , four big heavily-blurred gradient
 * blobs that drift on long offset CSS keyframe loops. the auth-card sits on
 * top with backdrop-filter and picks up these colours through the glass.
 * purely decorative , `prefers-reduced-motion` kills the animation via the
 * global rule in styles.css.
 *
 * Each blob lives in its own parallax wrapper. We push the normalized cursor
 * position into the root as `--mx`/`--my` (-1..1) via rAF-throttled
 * pointermove, and each layer translates by a per-layer depth — producing a
 * soft cursor-follow without fighting the keyframe drift on the blob itself.
 */
export function BackgroundFx(): JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null)
  const rafRef = useRef<number | null>(null)
  const targetRef = useRef({ x: 0, y: 0 })

  useEffect(() => {
    const onMove = (e: PointerEvent): void => {
      // Normalize to [-1, 1] across the viewport.
      targetRef.current.x = (e.clientX / window.innerWidth) * 2 - 1
      targetRef.current.y = (e.clientY / window.innerHeight) * 2 - 1
      if (rafRef.current != null) return
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null
        const el = rootRef.current
        if (!el) return
        el.style.setProperty('--mx', targetRef.current.x.toFixed(3))
        el.style.setProperty('--my', targetRef.current.y.toFixed(3))
      })
    }
    window.addEventListener('pointermove', onMove, { passive: true })
    return () => {
      window.removeEventListener('pointermove', onMove)
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
    }
  }, [])

  return (
    <div className="bgfx" ref={rootRef} aria-hidden="true" role="presentation">
      <span className="bgfx__layer bgfx__layer--1">
        <span className="bgfx__blob bgfx__blob--1" />
      </span>
      <span className="bgfx__layer bgfx__layer--2">
        <span className="bgfx__blob bgfx__blob--2" />
      </span>
      <span className="bgfx__layer bgfx__layer--3">
        <span className="bgfx__blob bgfx__blob--3" />
      </span>
      <span className="bgfx__layer bgfx__layer--4">
        <span className="bgfx__blob bgfx__blob--4" />
      </span>
      <span className="bgfx__grain" />
    </div>
  )
}
