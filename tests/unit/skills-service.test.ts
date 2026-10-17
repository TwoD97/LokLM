import { describe, expect, it, vi } from 'vitest'
import { SkillsService, type SkillActionStore } from '../../src/main/services/skills/SkillsService'
import { runOrganizerTool } from '../../src/main/services/skills/organizerTools'
import { OrganizerService } from '../../src/main/services/organizer/OrganizerService'
import { persistChatTurn, runChatTurn } from '../../src/main/services/qa/chatTurn'
import type { LlmProvider } from '../../src/main/services/providers/types'
import type { SkillAction, SkillTool } from '../../src/shared/connections'
import type { StreamEvent } from '../../src/shared/documents'

const plan = (tool: string, args: Record<string, unknown>, reply = '') =>
  JSON.stringify({ tool, arguments: JSON.stringify(args), reply })
const reference = { workspaceId: 1, conversationId: 2, messageId: 3, actionId: '' }
const signal = () => new AbortController().signal
function fixture(plans: string[] = []) {
  const data = new Map<string, string>()
  const organizer = new OrganizerService(
    {
      getKv: (key) => data.get(key) ?? null,
      setKv: (key, value) => {
        data.set(key, value)
      },
      deleteKv: (key) => {
        data.delete(key)
      },
      setKvDurably: async (key, value) => {
        if (value === null) data.delete(key)
        else data.set(key, value)
      },
    },
    async () => {},
    () => true,
  )
  const generateRaw = vi.fn<(prompt: string) => Promise<string>>(
    async () => plans.shift() ?? plan('', {}, 'Finished'),
  )
  const provider = { generateRaw, contextWindowTokens: () => 16384 } as unknown as LlmProvider
  const tool: SkillTool = {
    id: 'mcp:mail:nonce:send',
    name: 'send_email',
    description: 'Send email to a recipient',
    effect: 'external',
    source: 'mcp',
    inputSchema: { type: 'object' },
  }
  const connections = { tools: vi.fn(() => [tool]), call: vi.fn(async () => 'Sent message 42') }
  const service = new SkillsService(organizer, connections, () => provider)
  let actions: SkillAction[] = []
  const store: SkillActionStore = {
    getWithMessages: vi.fn(async () => ({
      messages: [
        {
          id: 3,
          role: 'assistant',
          content: 'Review action',
          skillActions: structuredClone(actions),
        },
      ],
    })),
    replaceSkillAction: vi.fn(async (_conversation, _message, action, expected) => {
      const index = actions.findIndex((item) => item.id === action.id)
      if (index < 0 || actions[index]!.status !== expected) throw new Error('Conflict')
      actions[index] = structuredClone(action)
    }),
  }
  return {
    service,
    provider,
    organizer,
    generateRaw,
    connections,
    store,
    tool,
    actions: () => actions,
    setActions: (value: SkillAction[]) => {
      actions = structuredClone(value)
    },
    async proposal(query = 'Create a task'): Promise<SkillAction> {
      const events: StreamEvent[] = []
      for await (const event of service.answer(query, { skills: true, language: 'en' }, signal()))
        events.push(event)
      const action = events.find(
        (event): event is Extract<StreamEvent, { type: 'skill' }> =>
          event.type === 'skill' && event.action.status === 'pending',
      )!.action
      actions = [structuredClone(action)]
      return action
    },
  }
}

describe('personal assistant tools and durable approval', () => {
  it('fits the complete prompt to a small context and keeps relevant mail tools discoverable', async () => {
    const f = fixture([plan('', {}, 'Ready')])
    f.provider.contextWindowTokens = () => 4096
    const query = 'Email person@example.com about tomorrow'
    for await (const event of f.service.answer(
      query,
      { history: [{ role: 'assistant', content: 'x'.repeat(20000) }] },
      signal(),
    )) {
      expect(event.type).not.toBe('error')
    }
    const prompt = f.generateRaw.mock.calls[0]![0]
    expect(prompt.length).toBeLessThanOrEqual((4096 - Math.floor(4096 / 3) - 512) * 2 - 1600)
    expect(JSON.parse(prompt).query).toBe(query)
    expect(JSON.parse(prompt).tools.some((tool: { id: string }) => tool.id === f.tool.id)).toBe(
      true,
    )
    f.generateRaw.mockClear()
    await expect(async () => {
      for await (const event of f.service.answer('x'.repeat(8000), {}, signal())) {
        expect(event.type).toBe('stage')
      }
    }).rejects.toThrow('context')
    expect(f.generateRaw).not.toHaveBeenCalled()
  })

  it('does not publish a proposal from a model that resolves after cancellation', async () => {
    const f = fixture()
    const controller = new AbortController()
    f.generateRaw.mockImplementationOnce(async () => {
      controller.abort()
      return plan('organizer.saveNote', { title: 'Cancelled', body: 'Never save' })
    })
    const observed: StreamEvent[] = []
    await expect(async () => {
      for await (const event of f.service.answer('Save a note', {}, controller.signal))
        observed.push(event)
    }).rejects.toThrow()
    expect(observed.some((event) => event.type === 'skill')).toBe(false)
    expect((await f.organizer.list()).notes).toHaveLength(0)
  })
  it('reads the real calendar without exposing unrelated notes and supplies the results to the model', async () => {
    const f = fixture([
      plan('organizer.search', { kind: 'events', dateFrom: '2026-10-18', dateTo: '2026-10-18' }),
      plan('', {}, 'You have a workshop at 10:00.'),
    ])
    await f.organizer.saveNote({ title: 'Secret unrelated note', body: 'PRIVATE NOTE CONTENT' })
    await f.organizer.saveEvent({
      title: 'Workshop',
      date: '2026-10-18',
      startTime: '10:00',
      endTime: '11:00',
      details: '',
    })
    const emitted: StreamEvent[] = []
    const result = await runChatTurn({
      stream: () => f.service.answer('What is on my calendar?', { skills: true }, signal()),
      signal: signal(),
      language: 'en',
      emit: (event) => emitted.push(event),
    })
    expect(result.content).toBe('You have a workshop at 10:00.')
    expect(result.skillActions).toHaveLength(1)
    expect(result.skillActions![0]!.status).toBe('completed')
    expect(JSON.stringify(f.generateRaw.mock.calls)).toContain('Workshop')
    expect(JSON.stringify(f.generateRaw.mock.calls)).not.toContain('PRIVATE NOTE CONTENT')
    expect(f.connections.call).not.toHaveBeenCalled()
  })

  it('proposes a write without changing data, then applies exactly once across concurrent approvals and reload', async () => {
    const f = fixture([
      plan('organizer.saveTask', {
        title: 'Prepare slides',
        completed: false,
        dueDate: '2026-10-19',
      }),
    ])
    const action = await f.proposal()
    expect((await f.organizer.list()).tasks).toHaveLength(0)
    const input = { ...reference, actionId: action.id }
    const [first, second] = await Promise.all([
      f.service.apply(f.store, input, signal()),
      f.service.apply(f.store, input, signal()),
    ])
    expect(first).toEqual(second)
    expect(first.status).toBe('completed')
    expect((await f.organizer.list()).tasks).toHaveLength(1)
    const afterReload = new SkillsService(f.organizer, f.connections, () => {
      throw new Error('No model needed to apply')
    })
    expect(await afterReload.apply(f.store, input, signal())).toEqual(first)
    expect((await f.organizer.list()).tasks).toHaveLength(1)
  })

  it('never sends mail while planning; approval records running before a single external invocation', async () => {
    const f = fixture([
      plan('mcp:mail:nonce:send', {
        to: 'person@example.com',
        subject: 'Meeting',
        body: 'Tomorrow?',
      }),
    ])
    const action = await f.proposal('Email person@example.com about tomorrow')
    expect(action.effect).toBe('external')
    expect(f.connections.call).not.toHaveBeenCalled()
    f.connections.call.mockImplementationOnce(async () => {
      expect(f.actions()[0]!.status).toBe('running')
      return 'Sent 42'
    })
    expect(
      (await f.service.apply(f.store, { ...reference, actionId: action.id }, signal())).result,
    ).toBe('Sent 42')
    expect(f.connections.call).toHaveBeenCalledOnce()
  })

  it('retains the running marker if the tool succeeded but receipt persistence failed, preventing replay', async () => {
    const f = fixture([plan('organizer.saveNote', { title: 'Draft', body: 'Saved content' })])
    const action = await f.proposal()
    const original = f.store.replaceSkillAction
    f.store.replaceSkillAction = async (...args) => {
      if (args[2].status === 'completed') throw new Error('Disk full')
      await original(...args)
    }
    await expect(
      f.service.apply(f.store, { ...reference, actionId: action.id }, signal()),
    ).rejects.toThrow('may have completed')
    expect(f.actions()[0]!.status).toBe('running')
    await f.service.apply(f.store, { ...reference, actionId: action.id }, signal())
    expect((await f.organizer.list()).notes).toHaveLength(1)
  })

  it('rejects stale revisions and cannot overwrite an edit made after proposal', async () => {
    const f = fixture()
    const note = await f.organizer.saveNote({ title: 'Meeting', body: 'Original' })
    f.generateRaw.mockResolvedValueOnce(
      plan('organizer.saveNote', {
        id: note.id,
        revision: note.revision,
        title: 'Meeting',
        body: 'AI update',
      }),
    )
    const action = await f.proposal()
    await f.organizer.saveNote({ ...note, body: 'User edit' })
    const result = await f.service.apply(f.store, { ...reference, actionId: action.id }, signal())
    expect(result.status).toBe('failed')
    expect(result.error).toContain('ORGANIZER_CONFLICT')
    expect((await f.organizer.list()).notes[0]!.body).toBe('User edit')
  })

  it('dismisses persistently and refuses changed tool definitions, unknown IDs and cancelled sessions', async () => {
    const f = fixture([plan('mcp:mail:nonce:send', { to: 'person@example.com' })])
    const action = await f.proposal('Send email')
    const input = { ...reference, actionId: action.id }
    f.connections.tools.mockReturnValueOnce([{ ...f.tool, description: 'Different tool' }])
    await expect(f.service.apply(f.store, input, signal())).rejects.toThrow('connection changed')
    await expect(f.service.apply(f.store, { ...input, messageId: 999 }, signal())).rejects.toThrow(
      'no longer exists',
    )
    const dismissed = await f.service.apply(f.store, input, signal(), true)
    expect(dismissed.status).toBe('dismissed')
    expect((await f.service.apply(f.store, input, signal())).status).toBe('dismissed')
    f.service.invalidate()
    await expect(f.service.apply(f.store, input, signal())).rejects.toThrow()
    expect(f.connections.call).not.toHaveBeenCalled()
  })

  it('rejects unavailable tools, invalid dates and injected fields before proposing executable actions', async () => {
    for (const output of [
      plan('shell.exec', { command: 'echo bad' }),
      plan('organizer.saveTask', { title: 'No', completed: false, dueDate: '2026-02-30' }),
      plan('organizer.saveNote', { title: 'No', body: '', command: 'bad' }),
    ]) {
      const f = fixture([output])
      const collect = async () => {
        for await (const event of f.service.answer('Do it', {}, signal()))
          expect(event.type).not.toBe('skill')
      }
      await expect(collect()).rejects.toThrow()
      expect(await f.organizer.list()).toEqual({ notes: [], tasks: [], events: [] })
    }
  })

  it('bounds organizer reads and explicitly reports truncation and pagination', async () => {
    const f = fixture()
    const note = await f.organizer.saveNote({ title: 'Long', body: 'a'.repeat(20000) })
    const result = await runOrganizerTool(f.organizer, 'organizer.get', {
      kind: 'notes',
      id: note.id,
    })
    expect(JSON.parse(result.result!).items[0].truncated).toBe(true)
    expect(result.result!.length).toBeLessThan(9000)
    for (let i = 0; i < 4; i++)
      await f.organizer.saveTask({ title: `Task ${i}`, completed: false, dueDate: null })
    const page = JSON.parse(
      (
        await runOrganizerTool(f.organizer, 'organizer.search', {
          kind: 'tasks',
          limit: 2,
          offset: 1,
        })
      ).result!,
    )
    expect(page).toMatchObject({ total: 4, offset: 1, hasMore: true })
    expect(page.items).toHaveLength(2)
  })

  it('persists deduplicated action cards before terminal delivery, including interrupted turns', async () => {
    const f = fixture([
      plan('organizer.saveTask', { title: 'Task', completed: false, dueDate: null }),
    ])
    const action = await f.proposal()
    const store = {
      appendMessage: vi.fn(async () => ({ id: 3 })),
      persistCitations: vi.fn(),
      deleteMessage: vi.fn(),
    }
    const emitted: StreamEvent[] = []
    const turn = await runChatTurn({
      stream: async function* () {
        yield { type: 'skill', action }
        yield { type: 'skill', action }
        throw new Error('Disconnected')
      },
      signal: signal(),
      language: 'en',
      emit: (event) => {
        if (event.type === 'error') expect(store.appendMessage).toHaveBeenCalledOnce()
        emitted.push(event)
      },
      persist: (turn) => persistChatTurn(store, 2, turn),
    })
    expect(turn.skillActions).toEqual([action])
    expect(store.appendMessage.mock.calls[0]).toHaveLength(6)
    expect(emitted.at(-1)).toMatchObject({ type: 'error', persisted: true, skillActions: [action] })
  })
})
