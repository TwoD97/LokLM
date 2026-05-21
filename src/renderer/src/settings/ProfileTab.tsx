import { useEffect, useState, useCallback, useRef } from 'react'
import { Avatar } from '../components/Avatar'

// Six hand-picked HSL hues across the wheel — enough variety that any
// initial reads well on every swatch. Saturation + lightness fixed so all
// presets look like siblings instead of one bright outlier.
const PRESET_HUES = [212, 268, 320, 16, 142, 192]

export function ProfileTab(): JSX.Element {
  const [savedName, setSavedName] = useState('')
  const [draftName, setDraftName] = useState('')
  const [editing, setEditing] = useState(false)
  const [avatarBytes, setAvatarBytes] = useState<Uint8Array | null>(null)
  const [activePresetHue, setActivePresetHue] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [savedFlash, setSavedFlash] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void window.api.auth.status().then((s) => {
      const name = s.displayName ?? ''
      setSavedName(name)
      setDraftName(name)
    })
    void window.api.settings.getAvatar().then((b) => setAvatarBytes(b ? Uint8Array.from(b) : null))
  }, [])

  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  const flashSaved = useCallback((): void => {
    setSavedFlash(true)
    setTimeout(() => setSavedFlash(false), 600)
  }, [])

  const saveName = useCallback(
    async (next: string): Promise<boolean> => {
      const trimmed = next.trim()
      if (trimmed.length === 0 || trimmed.length > 40) {
        setError('Display name must be 1–40 characters.')
        return false
      }
      setError(null)
      try {
        await window.api.settings.setDisplayName(trimmed)
        setSavedName(trimmed)
        setDraftName(trimmed)
        flashSaved()
        return true
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
        return false
      }
    },
    [flashSaved],
  )

  const startEdit = useCallback((): void => {
    setDraftName(savedName)
    setEditing(true)
    setError(null)
  }, [savedName])

  const commitEdit = useCallback(async (): Promise<void> => {
    if (draftName === savedName) {
      setEditing(false)
      return
    }
    const ok = await saveName(draftName)
    if (ok) setEditing(false)
  }, [draftName, savedName, saveName])

  const cancelEdit = useCallback((): void => {
    setDraftName(savedName)
    setEditing(false)
    setError(null)
  }, [savedName])

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
        setActivePresetHue(null)
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
    setActivePresetHue(null)
    flashSaved()
  }, [flashSaved])

  const pickPreset = useCallback(
    async (hue: number): Promise<void> => {
      try {
        const bytes = await renderPresetPng(hue, savedName)
        await window.api.settings.setAvatar(Array.from(bytes))
        setAvatarBytes(bytes)
        setActivePresetHue(hue)
        setError(null)
        flashSaved()
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    },
    [savedName, flashSaved],
  )

  return (
    <div>
      <div className="settings-profile-card">
        <Avatar bytes={avatarBytes} name={savedName} size={96} />
        <div className="settings-profile-card__actions">
          <button onClick={() => void pickAvatar()}>Upload…</button>
          <button onClick={() => void removeAvatar()} disabled={!avatarBytes}>
            Remove
          </button>
        </div>
        <div className="settings-profile-presets">
          <span className="settings-profile-presets__label">Or pick a preset</span>
          <div className="settings-profile-presets__row">
            {PRESET_HUES.map((hue) => (
              <button
                key={hue}
                className={`settings-profile-preset ${activePresetHue === hue ? 'settings-profile-preset--active' : ''}`}
                onClick={() => void pickPreset(hue)}
                aria-label={`Pick preset avatar ${hue}`}
                title="Pick preset avatar"
              >
                <span
                  className="settings-profile-preset__swatch"
                  style={{ background: `hsl(${hue}, 55%, 45%)` }}
                >
                  {initialOf(savedName)}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="settings-section-head">
        <span className="settings-section-head__title">Display name</span>
        <span className="settings-section-head__sub">1–40 characters.</span>
      </div>
      <div className={`settings-inline-field ${editing ? 'settings-inline-field--editing' : ''}`}>
        {editing ? (
          <>
            <input
              ref={inputRef}
              className="settings-inline-field__input"
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void commitEdit()
                else if (e.key === 'Escape') cancelEdit()
              }}
              maxLength={40}
            />
            <button
              className="settings-inline-field__action settings-inline-field__action--save"
              onClick={() => void commitEdit()}
              title="Save (Enter)"
            >
              ✓ Save
            </button>
            <button
              className="settings-inline-field__action settings-inline-field__action--cancel"
              onClick={cancelEdit}
              title="Cancel (Esc)"
            >
              ✕
            </button>
          </>
        ) : (
          <>
            <span className="settings-inline-field__value">{savedName || '—'}</span>
            <button className="settings-inline-field__action" onClick={startEdit} title="Edit">
              ✏ Edit
            </button>
          </>
        )}
      </div>
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

function initialOf(name: string): string {
  const t = name.trim()
  return t.length > 0 ? t[0]!.toUpperCase() : '?'
}

/** Render the picked preset to a 256x256 PNG and return the bytes. Same pixel
 *  shape as the upload path so all avatars travel through the same Uint8Array
 *  storage. */
async function renderPresetPng(hue: number, name: string): Promise<Uint8Array> {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 256
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not get 2D canvas context.')
  ctx.fillStyle = `hsl(${hue}, 55%, 45%)`
  ctx.beginPath()
  ctx.arc(128, 128, 128, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#fff'
  ctx.font = '600 120px Inter, system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(initialOf(name), 128, 140)
  const blob = await new Promise<Blob>((res, rej) =>
    canvas.toBlob((b) => (b ? res(b) : rej(new Error('toBlob produced no blob.'))), 'image/png'),
  )
  return new Uint8Array(await blob.arrayBuffer())
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
