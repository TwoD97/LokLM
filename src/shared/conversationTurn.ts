import type { DeleteConversationTurnInput } from './documents'

/** IPC input is untrusted even when the renderer has a typed API. */
export function validateDeleteConversationTurn(
  input: unknown,
): asserts input is DeleteConversationTurnInput {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error('Invalid conversation turn')
  }
  const value = input as Record<string, unknown>
  for (const key of ['workspaceId', 'conversationId', 'userMessageId', 'assistantMessageId']) {
    if (!Number.isSafeInteger(value[key]) || (value[key] as number) <= 0) {
      throw new Error('Invalid conversation turn')
    }
  }
  if (value.userMessageId === value.assistantMessageId) {
    throw new Error('Invalid conversation turn')
  }
}
