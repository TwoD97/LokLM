export interface AcceptedQuestion {
  ordinal: number
  stem: string
  options: string[]
  correctIndex: number
  explanation: string
  sourceChunkIds: number[]
  /** Unit section heading — surfaces in the UI as the question's topic. */
  themeTitle: string
}
