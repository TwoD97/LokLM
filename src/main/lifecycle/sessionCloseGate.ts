/** A lock includes draining private work, not just the final key wipe. New
 * authentication must wait for that entire transition before taking ownership. */
export class SessionCloseGate {
  private closing: Promise<void> | null = null

  close(work: () => Promise<void>): Promise<void> {
    if (this.closing) return this.closing
    let resolve!: () => void
    let reject!: (error: unknown) => void
    const pending = new Promise<void>((yes, no) => {
      resolve = yes
      reject = no
    })
    const completion = pending.finally(() => {
      if (this.closing === completion) this.closing = null
    })
    this.closing = completion
    // Publish the gate before work starts, including synchronous invalidation.
    try {
      void work().then(resolve, reject)
    } catch (error) {
      reject(error)
    }
    return completion
  }

  async waitForClose(): Promise<void> {
    while (this.closing) await this.closing
  }
}
