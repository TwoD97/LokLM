import { useEffect, useMemo } from 'react'

type Props = {
  bytes: Uint8Array | null
  name: string
  size: number
  alt?: string
}

export function Avatar({ bytes, name, size, alt }: Props): JSX.Element {
  const imgUrl = useMemo(() => {
    if (!bytes) return null
    // Copy into a fresh ArrayBuffer-backed view so the Blob ctor accepts it
    // regardless of whether the source buffer is ArrayBuffer or SharedArrayBuffer.
    const copy = new Uint8Array(bytes.byteLength)
    copy.set(bytes)
    return URL.createObjectURL(new Blob([copy.buffer], { type: 'image/png' }))
  }, [bytes])
  // URL.createObjectURL leaks the underlying Blob until revokeObjectURL fires.
  // Without this cleanup every avatar swap (or unmount) used to leak ~few-KB
  // blobs forever , the blobs accumulated for the lifetime of the renderer.
  useEffect(() => {
    if (!imgUrl) return
    return () => URL.revokeObjectURL(imgUrl)
  }, [imgUrl])

  if (imgUrl) {
    return (
      <img
        src={imgUrl}
        alt={alt ?? name}
        width={size}
        height={size}
        style={{ borderRadius: '50%', objectFit: 'cover', display: 'block' }}
      />
    )
  }

  const trimmed = name.trim()
  const initial = trimmed.length > 0 ? trimmed[0]!.toUpperCase() : '?'
  const color = colorFromString(trimmed.length > 0 ? trimmed : '?')
  return (
    <div
      data-testid="avatar-initials"
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: color,
        color: '#fff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: Math.round(size * 0.45),
        fontWeight: 600,
        userSelect: 'none',
      }}
    >
      {initial}
    </div>
  )
}

function colorFromString(s: string): string {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  const hue = h % 360
  return `hsl(${hue}, 55%, 45%)`
}
