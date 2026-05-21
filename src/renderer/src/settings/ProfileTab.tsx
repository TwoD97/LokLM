import { useEffect, useState, useCallback } from 'react'
import { Avatar } from '../components/Avatar'

export function ProfileTab(): JSX.Element {
  const [displayName, setDisplayName] = useState('')
  const [savedName, setSavedName] = useState('')
  const [avatarBytes, setAvatarBytes] = useState<Uint8Array | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [savedFlash, setSavedFlash] = useState(false)

  useEffect(() => {
    void window.api.auth.status().then((s) => {
      setDisplayName(s.displayName ?? '')
      setSavedName(s.displayName ?? '')
    })
    void window.api.settings.getAvatar().then((b) => setAvatarBytes(b ? Uint8Array.from(b) : null))
  }, [])

  const flashSaved = useCallback((): void => {
    setSavedFlash(true)
    setTimeout(() => setSavedFlash(false), 600)
  }, [])

  const saveName = useCallback(
    async (next: string): Promise<void> => {
      const trimmed = next.trim()
      if (trimmed.length === 0 || trimmed.length > 40) {
        setError('Display name must be 1–40 characters.')
        return
      }
      setError(null)
      try {
        await window.api.settings.setDisplayName(trimmed)
        setSavedName(trimmed)
        flashSaved()
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    },
    [flashSaved],
  )

  const pickAvatar = useCallback(async (): Promise<void> => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/png,image/jpeg,image/webp'
    input.onchange = async (): Promise<void> => {
      const file = input.files?.[0]
      if (!file) return
      if (file.size > 2 * 1024 * 1024) {
        setError('Avatar must be ≤ 2 MB.')
        return
      }
      try {
        const bytes = await downscaleTo256(file)
        await window.api.settings.setAvatar(Array.from(bytes))
        setAvatarBytes(bytes)
        setError(null)
        flashSaved()
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    }
    input.click()
  }, [flashSaved])

  const removeAvatar = useCallback(async (): Promise<void> => {
    await window.api.settings.setAvatar(null)
    setAvatarBytes(null)
    flashSaved()
  }, [flashSaved])

  return (
    <div>
      <div className="settings-profile-card">
        <Avatar bytes={avatarBytes} name={savedName} size={96} />
        <div className="settings-profile-card__actions">
          <button onClick={() => void pickAvatar()}>Change avatar…</button>
          <button onClick={() => void removeAvatar()} disabled={!avatarBytes}>
            Remove
          </button>
        </div>
      </div>

      <div className="settings-section-head">
        <span className="settings-section-head__title">Display name</span>
        <span className="settings-section-head__sub">1–40 characters. Saves on blur.</span>
      </div>
      <input
        value={displayName}
        onChange={(e) => setDisplayName(e.target.value)}
        onBlur={() => {
          if (displayName !== savedName) void saveName(displayName)
        }}
        style={{ width: '100%' }}
      />
      {error && <div style={{ color: 'var(--error)', marginTop: 6, fontSize: 13 }}>{error}</div>}

      <div className="settings-section-head">
        <span className="settings-section-head__title">Recovery</span>
        <span className="settings-section-head__sub">
          Vault is locked behind your passphrase and password.
        </span>
      </div>
      <div className="settings-stat">
        <span className="settings-stat__label">Status</span>
        <span className="settings-stat__value" style={{ color: 'var(--success)' }}>
          Recovery passphrase set ✓
        </span>
      </div>

      <div style={{ marginTop: 14 }}>
        <span className={`settings-saved-flash ${savedFlash ? 'settings-saved-flash--on' : ''}`}>
          ✓ saved
        </span>
      </div>
    </div>
  )
}

async function downscaleTo256(file: File): Promise<Uint8Array> {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image()
      i.onload = (): void => resolve(i)
      i.onerror = reject
      i.src = url
    })
    const canvas = document.createElement('canvas')
    canvas.width = 256
    canvas.height = 256
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Could not get 2D canvas context.')
    const scale = Math.max(256 / img.width, 256 / img.height)
    const dw = img.width * scale
    const dh = img.height * scale
    ctx.drawImage(img, (256 - dw) / 2, (256 - dh) / 2, dw, dh)
    const blob = await new Promise<Blob>((res, rej) =>
      canvas.toBlob((b) => (b ? res(b) : rej(new Error('toBlob produced no blob.'))), 'image/png'),
    )
    return new Uint8Array(await blob.arrayBuffer())
  } finally {
    URL.revokeObjectURL(url)
  }
}
