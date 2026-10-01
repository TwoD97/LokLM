import { describe, expect, it } from 'vitest'
import { SessionRequests } from './sessionRequests'

describe('session inference requests', () => {
  it('invalidates delayed initialization even before any request has started', () => {
    const requests = new SessionRequests()
    const opening = requests.captureSession()
    requests.reset()
    const nextOpening = requests.captureSession()
    expect(opening()).toBe(false)
    expect(nextOpening()).toBe(true)
  })
  it('scopes cancellation to the requesting window and feature', () => {
    const requests = new SessionRequests()
    const first = requests.begin('chat', 1, 'same-id')
    const otherWindow = requests.begin('chat', 2, 'same-id')
    const otherFeature = requests.begin('quiz', 1, 'same-id')
    requests.cancel('chat', 1, 'same-id')
    expect(first.controller.signal.aborted).toBe(true)
    expect(otherWindow.controller.signal.aborted).toBe(false)
    expect(otherFeature.controller.signal.aborted).toBe(false)
    expect(first.isCurrent()).toBe(true) // ordinary Stop may persist partial text
  })

  it('rejects duplicate starts without losing the original cancellation handle', () => {
    const requests = new SessionRequests()
    const original = requests.begin('translation', 1, 'job')
    expect(() => requests.begin('translation', 1, 'job')).toThrow(/already running/)
    requests.cancel('translation', 1, 'job')
    expect(original.controller.signal.aborted).toBe(true)
  })

  it('retires every feature at a vault boundary and ignores stale completion', () => {
    const requests = new SessionRequests()
    const old = ['chat', 'quiz', 'translation', 'writing'].map((scope) =>
      requests.begin(scope as 'chat' | 'quiz' | 'translation' | 'writing', 1, 'job'),
    )
    requests.reset()
    for (const request of old) {
      expect(request.controller.signal.aborted).toBe(true)
      expect(request.isCurrent()).toBe(false)
    }
    const current = requests.begin('chat', 1, 'job')
    old[0]!.finish()
    expect(current.isCurrent()).toBe(true)
    expect(requests.has('chat')).toBe(true)
    current.finish()
    expect(requests.has('chat')).toBe(false)
  })

  it('retires entries before invoking abort callbacks', () => {
    const requests = new SessionRequests()
    const old = requests.begin('chat', 1, 'job')
    let replacement: ReturnType<SessionRequests['begin']> | undefined
    old.controller.signal.addEventListener('abort', () => {
      replacement = requests.begin('chat', 1, 'job')
    })
    requests.reset()
    expect(replacement?.controller.signal.aborted).toBe(false)
    old.finish()
    expect(replacement?.isCurrent()).toBe(true)
  })
})
