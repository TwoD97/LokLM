import { useEffect, useState, useCallback, useRef } from 'react'
import { Check, Pencil, X } from 'lucide-react'
import { Avatar } from '../components/Avatar'
import { avatarColorForHue } from '../components/avatarColors'
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
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [nameBusy, setNameBusy] = useState(false)
  const [avatarBusy, setAvatarBusy] = useState(false)
  const namePending = useRef(false)
  const avatarPending = useRef(false)
  const passwordPending = useRef(false)
  // AP-9 Account "Passwort ändern" — own form state, kept out of the
  // name/avatar `error`/`savedFlash` so the two sections don't cross-talk.
  const [pwCurrent, setPwCurrent] = useState('')
  const [pwNew, setPwNew] = useState('')
  const [pwConfirm, setPwConfirm] = useState('')
  const [pwError, setPwError] = useState<string | null>(null)
  const [pwBusy, setPwBusy] = useState(false)
  const [recoveryModalOpen, setRecoveryModalOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadFailed(false)
    try {
      const [status, avatar] = await Promise.all([
        window.api.auth.status(),
        window.api.settings.getAvatar(),
      ])
      setSavedName(status.displayName ?? '')
      setDraftName(status.displayName ?? '')
      setAvatarBytes(avatar ? Uint8Array.from(avatar) : null)
    } catch {
      setLoadFailed(true)
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  const flashSaved = useCallback((): void => {
    setSavedFlash(true)
    setTimeout(() => setSavedFlash(false), 600)
  }, [])

  const saveName = useCallback(
    async (next: string): Promise<boolean> => {
      if (namePending.current) return false
      const trimmed = next.trim()
      if (trimmed.length === 0 || trimmed.length > 40) {
        setError(t('settings.profile.displayNameError'))
        return false
      }
      setError(null)
      namePending.current = true
      setNameBusy(true)
      try {
        await window.api.settings.setDisplayName(trimmed)
        setSavedName(trimmed)
        setDraftName(trimmed)
        flashSaved()
        return true
      } catch {
        setError(t('prefs.saveFailed'))
        return false
      } finally {
        namePending.current = false
        setNameBusy(false)
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

  const changeAvatar = useCallback(
    async (operation: () => Promise<void>): Promise<void> => {
      if (avatarPending.current) return
      avatarPending.current = true
      setAvatarBusy(true)
      setError(null)
      try {
        await operation()
        flashSaved()
      } catch {
        setError(t('prefs.saveFailed'))
      } finally {
        avatarPending.current = false
        setAvatarBusy(false)
      }
    },
    [flashSaved, t],
  )

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
      await changeAvatar(async () => {
        const bytes = await downscaleTo256(file)
        await window.api.settings.setAvatar(Array.from(bytes))
        setAvatarBytes(bytes)
        setActivePresetHue(null)
        setError(null)
      })
    }
    input.click()
  }, [changeAvatar, t])

  const removeAvatar = useCallback(async (): Promise<void> => {
    await changeAvatar(async () => {
      await window.api.settings.setAvatar(null)
      setAvatarBytes(null)
      setActivePresetHue(null)
    })
  }, [changeAvatar])

  const pickPreset = useCallback(
    async (hue: number): Promise<void> => {
      await changeAvatar(async () => {
        const bytes = await renderPresetPng(hue, savedName)
        await window.api.settings.setAvatar(Array.from(bytes))
        setAvatarBytes(bytes)
        setActivePresetHue(hue)
        setError(null)
      })
    },
    [savedName, changeAvatar],
  )

  const submitPassword = useCallback(async (): Promise<void> => {
    if (passwordPending.current || !pwCurrent || !pwNew || !pwConfirm) return
    setPwError(null)
    if (pwNew !== pwConfirm) {
      setPwError(t('settings.profile.pwMismatch'))
      return
    }
    passwordPending.current = true
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
      passwordPending.current = false
      setPwBusy(false)
    }
  }, [pwCurrent, pwNew, pwConfirm, t, flashSaved])

  return (
    <div>
      {loading && <p role="status">{t('settings.loading')}</p>}
      {loadFailed && (
        <p className="preferences-error" role="alert">
          {t('settings.profile.loadError')}{' '}
          <button type="button" onClick={() => void load()}>
            {t('prefs.retry')}
          </button>
        </p>
      )}
      <div className="settings-profile-card">
        <Avatar bytes={avatarBytes} name={savedName} size={96} />
        <div className="settings-profile-card__actions">
          <button onClick={() => void pickAvatar()} disabled={loading || avatarBusy}>
            {t('settings.profile.upload')}
          </button>
          <button onClick={() => void removeAvatar()} disabled={!avatarBytes || avatarBusy}>
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
                disabled={loading || avatarBusy}
                className={`settings-profile-preset ${activePresetHue === hue ? 'settings-profile-preset--active' : ''}`}
                onClick={() => void pickPreset(hue)}
                aria-label={t('settings.profile.pickPresetAvatarNum', { num: hue })}
                title={t('settings.profile.pickPresetAvatar')}
              >
                <span
                  className="settings-profile-preset__swatch"
                  style={{ background: avatarColorForHue(hue) }}
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
              aria-label={t('settings.profile.displayName')}
              name="profile-display-name"
              autoComplete="nickname"
              disabled={nameBusy}
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing) void commitEdit()
                else if (e.key === 'Escape' && !nameBusy) {
                  e.preventDefault()
                  e.stopPropagation()
                  cancelEdit()
                }
              }}
              maxLength={40}
            />
            <button
              className="settings-inline-field__action settings-inline-field__action--save"
              onClick={() => void commitEdit()}
              disabled={nameBusy}
              title={t('settings.profile.editSave')}
            >
              <Check size={16} aria-hidden="true" /> {t('common.save')}
            </button>
            <button
              className="settings-inline-field__action settings-inline-field__action--cancel"
              onClick={cancelEdit}
              disabled={nameBusy}
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
              disabled={loading || loadFailed}
              title={t('settings.profile.edit')}
            >
              <Pencil size={14} aria-hidden="true" /> {t('settings.profile.edit')}
            </button>
          </>
        )}
      </div>
      {error && (
        <div role="alert" className="preferences-error">
          {error}
        </div>
      )}

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
      <form
        style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 360 }}
        onSubmit={(event) => {
          event.preventDefault()
          void submitPassword()
        }}
      >
        <label className="preferences-field">
          <span>{t('settings.profile.currentPassword')}</span>
          <input
            name="current-password"
            disabled={pwBusy}
            type="password"
            autoComplete="current-password"
            placeholder={t('settings.profile.currentPassword')}
            value={pwCurrent}
            onChange={(e) => setPwCurrent(e.target.value)}
          />
        </label>
        <label className="preferences-field">
          <span>{t('settings.profile.newPassword')}</span>
          <input
            name="new-password"
            disabled={pwBusy}
            type="password"
            autoComplete="new-password"
            placeholder={t('settings.profile.newPassword')}
            value={pwNew}
            onChange={(e) => setPwNew(e.target.value)}
          />
        </label>
        <label className="preferences-field">
          <span>{t('settings.profile.confirmPassword')}</span>
          <input
            name="confirm-password"
            disabled={pwBusy}
            type="password"
            autoComplete="new-password"
            placeholder={t('settings.profile.confirmPassword')}
            value={pwConfirm}
            onChange={(e) => setPwConfirm(e.target.value)}
          />
        </label>
        <button
          type="submit"
          style={{ alignSelf: 'flex-start' }}
          disabled={!pwCurrent || !pwNew || !pwConfirm || pwBusy}
        >
          {t('settings.profile.changePasswordAction')}
        </button>
        {pwError && (
          <div role="alert" className="preferences-error">
            {pwError}
          </div>
        )}
      </form>

      <div style={{ marginTop: 14 }}>
        <span
          role="status"
          className={`settings-saved-flash ${savedFlash ? 'settings-saved-flash--on' : ''}`}
        >
          {savedFlash && (
            <>
              <Check size={14} aria-hidden="true" /> {t('settings.profile.saved')}
            </>
          )}
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
  ctx.fillStyle = avatarColorForHue(hue)
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
