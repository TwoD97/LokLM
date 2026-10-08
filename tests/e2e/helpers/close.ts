import type { ElectronApplication } from '@playwright/test'

export interface ConfirmedAppClosure {
  mainProcessId: number | null
  exitCode: number | null
  signalCode: NodeJS.Signals | null
  alreadyExited: boolean
}

/** Confirms only this launched main process, never a process name or PID sweep. */
export async function closeOwnedApplication(
  app: Pick<ElectronApplication, 'process' | 'close'>,
): Promise<ConfirmedAppClosure> {
  const child = app.process()
  const hasExited = (): boolean => child.exitCode !== null || child.signalCode !== null
  const alreadyExited = hasExited()
  let timer: ReturnType<typeof setTimeout> | undefined
  let onExit: () => void
  const exited = new Promise<void>((resolve) => {
    onExit = resolve
    child.once('exit', onExit)
  })
  try {
    // Already manually closed apps are common in restart/persistence tests.
    // Otherwise a close rejection must propagate even if exit races with it.
    if (!alreadyExited) await app.close()
    if (!hasExited()) {
      await Promise.race([
        exited,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error('Launched Electron process did not confirm exit.')),
            5_000,
          )
        }),
      ])
    }
    if (!hasExited()) throw new Error('Launched Electron process did not confirm exit.')
    return {
      mainProcessId: child.pid ?? null,
      exitCode: child.exitCode,
      signalCode: child.signalCode,
      alreadyExited,
    }
  } finally {
    if (timer) clearTimeout(timer)
    child.removeListener('exit', onExit!)
  }
}
