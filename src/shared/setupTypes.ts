export type SetupOptions = {
  createDesktopShortcut: boolean
  createStartMenuShortcut: boolean
  enableAutostart: boolean
}

export type SetupStatus = {
  firstRunDone: boolean
  options: SetupOptions | null
}
