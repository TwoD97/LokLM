/**
 * First-launch / recovery view shown when one or more required model files
 * are missing on disk. Drives the manifest-based download sequence:
 *
 *  - Load the current `models:status` once on mount.
 *  - Subscribe to `models:onProgress` for live updates while downloading.
 *  - Download required models in series (HuggingFace handles parallel fine
 *    but serial gives a deterministic UI + predictable bandwidth use).
 *  - When all required models are present, call `onReady` so the parent can
 *    proceed to the normal auth flow.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Check } from 'lucide-react'
import type { ModelAvailability, ModelsStatus } from '@shared/documents'
import type { ModelDownloadEvent } from '@preload/index'

type Props = {
  onReady: () => void
}

type RowState = {
  /** Live phase from the downloader. Mirrors the IPC event's `phase`. */
  phase: 'idle' | 'downloading' | 'verifying' | 'complete' | 'error' | 'cancelled'
  bytesReceived: number
  totalBytes: number
  bytesPerSec: number | null
  message: string | null
}

function initialRow(model: ModelAvailability): RowState {
  return {
    phase: model.present ? 'complete' : 'idle',
    bytesReceived: model.present ? model.sizeBytes : 0,
    totalBytes: model.sizeBytes,
    bytesPerSec: null,
    message: null,
  }
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  const mb = n / (1024 * 1024)
  if (mb < 1024) return `${mb.toFixed(0)} MB`
  const gb = mb / 1024
  return `${gb.toFixed(2)} GB`
}

function formatRate(n: number | null): string {
  if (n == null || n <= 0) return ''
  const mb = n / (1024 * 1024)
  return `${mb.toFixed(1)} MB/s`
}

export function ModelDownloadView({ onReady }: Props): JSX.Element {
  const [status, setStatus] = useState<ModelsStatus | null>(null)
  const [rows, setRows] = useState<Record<string, RowState>>({})
  const [running, setRunning] = useState(false)
  const [spaceWarning, setSpaceWarning] = useState<string | null>(null)
  // Track in-flight model id so the Cancel button only cancels the right one.
  const activeIdRef = useRef<string | null>(null)
  // Set by the Cancel button so the queue loop can break out between items ,
  // without this, cancelling stopped only the current download and the queue
  // happily started the next one. Ref (not state) so the running closure sees
  // the latest value without re-creating startDownload.
  const cancelRequestedRef = useRef(false)

  const refreshStatus = useCallback(async () => {
    const s = await window.api.models.status()
    setStatus(s)
    setRows((prev) => {
      const next: Record<string, RowState> = { ...prev }
      for (const m of s.models) {
        // Don't stomp an in-flight row; only seed the ones we don't have.
        if (!next[m.id]) next[m.id] = initialRow(m)
      }
      return next
    })
    if (s.allRequiredReady) onReady()
  }, [onReady])

  useEffect(() => {
    void refreshStatus()
  }, [refreshStatus])

  // Subscribe to progress events for the whole lifetime of the view. The
  // unsubscribe runs on unmount.
  useEffect(() => {
    let unsub: (() => void) | null = null
    let cancelled = false
    void window.api.models
      .onProgress((ev: ModelDownloadEvent) => {
        setRows((prev) => ({
          ...prev,
          [ev.id]: {
            phase: ev.phase,
            bytesReceived: ev.bytesReceived,
            totalBytes: ev.totalBytes,
            bytesPerSec: ev.bytesPerSec,
            message: ev.message,
          },
        }))
      })
      .then((off) => {
        if (cancelled) off()
        else unsub = off
      })
    return () => {
      cancelled = true
      if (unsub) unsub()
    }
  }, [])

  const startDownload = useCallback(async () => {
    if (!status) return
    setSpaceWarning(null)
    cancelRequestedRef.current = false
    // Disk-space pre-check , failing 6 GB into a 7 GB download because /
    // is full is a brutal first-run experience. statfs lives in main; if
    // the probe itself errors we silently continue (unknown:true path).
    const queue = status.models.filter((m) => m.required && !m.present)
    const required = queue.reduce((acc, m) => acc + m.sizeBytes, 0)
    if (required > 0) {
      try {
        const result = await window.api.models.checkSpace(required)
        if (!result.unknown && !result.ok) {
          setSpaceWarning(
            `Nicht genug freier Speicher: benötigt ${formatBytes(result.requiredBytes)}, ` +
              `verfügbar ${formatBytes(result.availableBytes)}.`,
          )
          return
        }
      } catch {
        // probe failed entirely — continue and let the actual download surface
        // a disk-full error if one happens.
      }
    }
    setRunning(true)
    try {
      // Serial download — embedder first (small, smoke-tests the connection),
      // then the rest in manifest order.
      for (const m of queue) {
        if (cancelRequestedRef.current) break
        activeIdRef.current = m.id
        try {
          await window.api.models.download(m.id)
        } catch (err) {
          // Error already surfaced via the progress event; stop the queue so
          // the user can retry / inspect.
          activeIdRef.current = null
           
          console.error(`[models] download ${m.id} failed`, err)
          return
        }
      }
      activeIdRef.current = null
      // Final re-check pulls the truth from disk and triggers `onReady` if all
      // required models are now present.
      await refreshStatus()
    } finally {
      setRunning(false)
      cancelRequestedRef.current = false
    }
  }, [status, refreshStatus])

  const cancelQueue = useCallback(async () => {
    // Stop the queue AND the in-flight item. Order matters: set the ref
    // first so the loop's between-items check breaks out even if the
    // models.cancel IPC resolves before the download promise rejects.
    cancelRequestedRef.current = true
    const id = activeIdRef.current
    if (id) await window.api.models.cancel(id)
  }, [])

  if (!status) {
    return (
      <section className="auth-card">
        <p>Lade Modellstatus…</p>
      </section>
    )
  }

  const required = status.models.filter((m) => m.required)
  const totalRequiredBytes = required.reduce((acc, m) => acc + m.sizeBytes, 0)
  const totalDownloadedBytes = required.reduce((acc, m) => {
    const row = rows[m.id]
    if (!row) return acc + (m.present ? m.sizeBytes : 0)
    return acc + Math.min(row.bytesReceived, m.sizeBytes)
  }, 0)
  const overallPct = totalRequiredBytes > 0 ? (totalDownloadedBytes / totalRequiredBytes) * 100 : 0
  const anyError = Object.values(rows).some((r) => r.phase === 'error')
  const allDone = required.every((m) => rows[m.id]?.phase === 'complete' || m.present)

  return (
    <section className="auth-card models-card">
      <h1>Willkommen bei LokLM</h1>
      <p className="models-card__intro">
        Für den ersten Start laden wir das Sprachmodell und die Hilfsdateien herunter (insgesamt ≈{' '}
        {formatBytes(totalRequiredBytes)}). Das passiert nur einmal — danach läuft alles vollständig
        lokal.
      </p>

      <ul className="models-list">
        {required.map((m) => {
          const row = rows[m.id] ?? initialRow(m)
          const pct = row.totalBytes > 0 ? (row.bytesReceived / row.totalBytes) * 100 : 0
          return (
            <li key={m.id} className={`models-list__row models-list__row--${row.phase}`}>
              <div className="models-list__head">
                <span className="models-list__label">{m.label}</span>
                <span className="models-list__size">{formatBytes(m.sizeBytes)}</span>
              </div>
              <p className="models-list__desc">{m.description}</p>
              <div className="models-list__bar">
                <div
                  className="models-list__bar-fill"
                  style={{ width: `${Math.min(100, pct).toFixed(1)}%` }}
                />
              </div>
              <div className="models-list__status">
                {row.phase === 'idle' && !m.present && <span>Wartet auf Download</span>}
                {row.phase === 'downloading' && (
                  <span>
                    {formatBytes(row.bytesReceived)} / {formatBytes(row.totalBytes)}
                    {row.bytesPerSec ? ` · ${formatRate(row.bytesPerSec)}` : ''}
                  </span>
                )}
                {row.phase === 'verifying' && <span>Verifiziere …</span>}
                {row.phase === 'complete' && (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <Check size={14} aria-hidden="true" /> Bereit
                  </span>
                )}
                {row.phase === 'cancelled' && <span>Abgebrochen — kann fortgesetzt werden</span>}
                {row.phase === 'error' && (
                  <span className="models-list__error">Fehler: {row.message ?? 'unbekannt'}</span>
                )}
              </div>
            </li>
          )
        })}
      </ul>

      {spaceWarning && (
        <p className="models-list__error" role="alert" style={{ marginTop: 12 }}>
          {spaceWarning}
        </p>
      )}

      <div className="models-card__actions">
        {!running && !allDone && (
          <button type="button" onClick={() => void startDownload()}>
            {anyError ? 'Erneut versuchen' : 'Download starten'}
          </button>
        )}
        {running && (
          <button type="button" onClick={() => void cancelQueue()} className="ghost">
            Abbrechen
          </button>
        )}
        {allDone && (
          <button type="button" onClick={() => onReady()}>
            Weiter
          </button>
        )}
      </div>

      <p className="models-card__progress">
        Gesamt: {formatBytes(totalDownloadedBytes)} / {formatBytes(totalRequiredBytes)} ·{' '}
        {overallPct.toFixed(1)}%
      </p>
      <p className="models-card__path">
        Speicherort: <code>{status.downloadDir}</code>
      </p>
    </section>
  )
}
