import { describe, expect, it } from 'vitest'
import { validateDeleteConversationTurn } from './conversationTurn'

const valid = { workspaceId: 1, conversationId: 2, userMessageId: 3, assistantMessageId: 4 }

describe('conversation turn IPC validation', () => {
  it('accepts only positive safe integer identifiers and distinct message IDs', () => {
    expect(() => validateDeleteConversationTurn(valid)).not.toThrow()
    for (const key of Object.keys(valid)) {
      for (const value of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, '1', null]) {
        expect(() => validateDeleteConversationTurn({ ...valid, [key]: value })).toThrow(
          'Invalid conversation turn',
        )
      }
    }
    for (const input of [undefined, null, [], {}, 'turn', { ...valid, assistantMessageId: 3 }]) {
      expect(() => validateDeleteConversationTurn(input)).toThrow('Invalid conversation turn')
    }
  })
})
