import { useEffect, useState, useCallback, useRef } from 'react'
import { Check, Pencil, X } from 'lucide-react'
import { Avatar } from '../components/Avatar'
import { RecoveryCodesModal } from './RecoveryCodesModal'
import { useT } from '../i18n'

// Six hand-picked HSL hues across the wheel — enough variety that any
// initial reads well on every swatch. Saturation + lightness fixed so all
// presets look like siblings instead of one bright outlier.
const PRESET_HUES = [212, 268, 320, 16, 142, 192]

export function ProfileTab(): JSX.Element {
  const t = useT()
  const [savedName, setSavedName] = useState('')
  const [draftName, setDraftName] = useState('')
  const [editing, setEditing] = useState(false)
  const [avatarBytes, setAvatarBytes] = useState<Uint8Array | null>(null)
  const [activePresetHue, setActivePresetHue] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [savedFlash, setSavedFlash] = useState(false)
  // AP-9 Account §3.8 "Passwort ändern" — own form state, kept out of the
  // name/avatar `error`/`savedFlash` so the two sections don't cross-talk.
  const [pwCurrent, setPwCurrent] = useState('')
  const [pwNew, setPwNew] = useState('')
  const [pwConfirm, setPwConfirm] = useState('')
  const [pwError, setPwError] = useState<string | null>(null)
  const [pwBusy, setPwBusy] = useState(false)
  const [recoveryModalOpen, setRecoveryModalOpen] = useState(false)
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
        setError(t('settings.profile.displayNameError'))
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
    [flashSaved, t],
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
        setError(t('settings.profile.avatarSizeError'))
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
  }, [flashSaved, t])

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

  const submitPassword = useCallback(async (): Promise<void> => {
    setPwError(null)
    if (pwNew !== pwConfirm) {
      setPwError(t('settings.profile.pwMismatch'))
      return
    }
    setPwBusy(true)
    try {
      const res = await window.api.auth.changePassword(pwCurrent, pwNew)
      if (res.ok) {
        setPwCurrent('')
        setPwNew('')
        setPwConfirm('')
        flashSaved()
        return
      }
      if (res.reason === 'weak_password') setPwError(res.message)
      else if (res.reason === 'bad_password') setPwError(t('settings.profile.pwWrongCurrent'))
      else if (res.reason === 'rate_limited') setPwError(t('settings.profile.pwRateLimited'))
      else setPwError(t('settings.profile.pwError'))
    } catch (e) {
      setPwError(e instanceof Error ? e.message : String(e))
    } finally {
      setPwBusy(false)
    }
  }, [pwCurrent, pwNew, pwConfirm, t, flashSaved])

  return (
    <div>
      <div className="settings-profile-card">
        <Avatar bytes={avatarBytes} name={savedName} size={96} />
        <div className="settings-profile-card__actions">
          <button onClick={() => void pickAvatar()}>{t('settings.profile.upload')}</button>
          <button onClick={() => void removeAvatar()} disabled={!avatarBytes}>
            {t('common.remove')}
          </button>
        </div>
        <div className="settings-profile-presets">
          <span className="settings-profile-presets__label">
            {t('settings.profile.orPickPreset')}
          </span>
          <div className="settings-profile-presets__row">
            {PRESET_HUES.map((hue) => (
              <button
                key={hue}
                className={`settings-profile-preset ${activePresetHue === hue ? 'settings-profile-preset--active' : ''}`}
                onClick={() => void pickPreset(hue)}
                aria-label={t('settings.profile.pickPresetAvatarNum', { num: hue })}
                title={t('settings.profile.pickPresetAvatar')}
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
        <span className="settings-section-head__title">{t('settings.profile.displayName')}</span>
        <span className="settings-section-head__sub">{t('settings.profile.displayNameSub')}</span>
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
              title={t('settings.profile.editSave')}
            >
              <Check size={16} aria-hidden="true" /> {t('common.save')}
            </button>
            <button
              className="settings-inline-field__action settings-inline-field__action--cancel"
              onClick={cancelEdit}
              title={t('settings.profile.editCancel')}
              aria-label={t('common.cancel')}
            >
              <X size={16} aria-hidden="true" />
            </button>
          </>
        ) : (
          <>
            <span className="settings-inline-field__value">{savedName || '—'}</span>
            <button
              className="settings-inline-field__action"
              onClick={startEdit}
              title={t('settings.profile.edit')}
            >
              <Pencil size={14} aria-hidden="true" /> {t('settings.profile.edit')}
            </button>
          </>
        )}
      </div>
      {error && <div style={{ color: 'var(--error)', marginTop: 6, fontSize: 13 }}>{error}</div>}

      <div className="settings-section-head">
        <span className="settings-section-head__title">{t('settings.profile.recovery')}</span>
        <span className="settings-section-head__sub">{t('settings.profile.recoverySub')}</span>
      </div>
      <div className="settings-stat">
        <span className="settings-stat__label">{t('settings.profile.status')}</span>
        <span
          className="settings-stat__value"
          style={{
            color: 'var(--success)',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
          }}
        >
          {t('settings.profile.recoverySet')} <Check size={14} aria-hidden="true" />
        </span>
      </div>
      <div style={{ marginTop: 10 }}>
        <button type="button" onClick={() => setRecoveryModalOpen(true)}>
          {t('settings.profile.newRecoveryButton')}
        </button>
      </div>
      {recoveryModalOpen && <RecoveryCodesModal onClose={() => setRecoveryModalOpen(false)} />}

      <div className="settings-section-head">
        <span className="settings-section-head__title">{t('settings.profile.changePassword')}</span>
        <span className="settings-section-head__sub">
          {t('settings.profile.changePasswordSub')}
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 360 }}>
        <input
          type="password"
          autoComplete="current-password"
          placeholder={t('settings.profile.currentPassword')}
          value={pwCurrent}
          onChange={(e) => setPwCurrent(e.target.value)}
        />
        <input
          type="password"
          autoComplete="new-password"
          placeholder={t('settings.profile.newPassword')}
          value={pwNew}
          onChange={(e) => setPwNew(e.target.value)}
        />
        <input
          type="password"
          autoComplete="new-password"
          placeholder={t('settings.profile.confirmPassword')}
          value={pwConfirm}
          onChange={(e) => setPwConfirm(e.target.value)}
        />
        <button
          style={{ alignSelf: 'flex-start' }}
          disabled={!pwCurrent || !pwNew || !pwConfirm || pwBusy}
          onClick={() => void submitPassword()}
        >
          {t('settings.profile.changePasswordAction')}
        </button>
        {pwError && <div style={{ color: 'var(--error)', fontSize: 13 }}>{pwError}</div>}
      </div>

      <div style={{ marginTop: 14 }}>
        <span className={`settings-saved-flash ${savedFlash ? 'settings-saved-flash--on' : ''}`}>
          <Check size={14} aria-hidden="true" /> {t('settings.profile.saved')}
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
