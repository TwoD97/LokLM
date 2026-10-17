import { isOrganizerDate, isOrganizerTime, ORGANIZER_LIMITS } from '../../../shared/organizer'
import type { OrganizerApi, OrganizerSnapshot } from '../../../shared/organizer'
import type { SkillAction, SkillTool } from '../../../shared/connections'

type Organizer = Omit<OrganizerApi, 'onChanged'>
type Args = Record<string, unknown>
const text = { type: 'string' }
const nullableText = { type: ['string', 'null'] }
const record = { id: text, revision: { type: 'integer', minimum: 1 } }
const READ_PAGE_LIMIT = 8000
function tool(
  name: string,
  description: string,
  effect: 'read' | 'write',
  properties: Args,
  required: string[],
): SkillTool {
  return {
    id: `organizer.${name}`,
    name,
    description,
    effect,
    source: 'organizer',
    inputSchema: { type: 'object', properties, required, additionalProperties: false },
  }
}

export const ORGANIZER_TOOLS: SkillTool[] = [
  tool(
    'search',
    'Search local calendar events, tasks and notes. Dates are local YYYY-MM-DD. Use dateFrom/dateTo for calendar or task due dates. Results include IDs and revisions for updates; note bodies are previews. Results can be paged with offset.',
    'read',
    {
      kind: { enum: ['events', 'tasks', 'notes', 'all'] },
      query: text,
      dateFrom: text,
      dateTo: text,
      completed: { type: 'boolean' },
      limit: { type: 'integer', minimum: 1, maximum: 30 },
      offset: { type: 'integer', minimum: 0 },
    },
    [],
  ),
  tool(
    'get',
    'Read an organizer item by kind and ID. For note bodies and event details, offset is a character offset and limit is at most 8000. bodyLength/detailsLength, truncated, hasMore and nextOffset describe partial content. Read later pages before summarizing a whole note; use editNote to change one exact excerpt without losing unread text.',
    'read',
    {
      kind: { enum: ['notes', 'tasks', 'events'] },
      id: text,
      offset: { type: 'integer', minimum: 0 },
      limit: { type: 'integer', minimum: 1, maximum: READ_PAGE_LIMIT },
    },
    ['kind', 'id'],
  ),
  tool(
    'saveNote',
    'Propose creating or replacing a note. Updates require its current id and revision and complete intended body. Existing notes longer than 8000 characters cannot be replaced with this tool: use editNote instead. Omit id/revision to create.',
    'write',
    { ...record, title: text, body: text },
    ['title', 'body'],
  ),
  tool(
    'editNote',
    'Propose replacing one exact, unique excerpt in a note. Requires current id and revision. find must occur exactly once; replace may be empty. All other text, including unread pages of long notes, is preserved. Use get to read the exact excerpt first.',
    'write',
    { ...record, find: text, replace: text },
    ['id', 'revision', 'find', 'replace'],
  ),
  tool(
    'saveTask',
    'Propose creating or updating a task. dueDate is YYYY-MM-DD or null; completed is boolean. Updates require current id/revision.',
    'write',
    { ...record, title: text, completed: { type: 'boolean' }, dueDate: nullableText },
    ['title', 'completed', 'dueDate'],
  ),
  tool(
    'saveEvent',
    'Propose creating or updating a local calendar event. date is YYYY-MM-DD; startTime/endTime are HH:mm or both null for all-day. No reminders or invitations are sent. Updates require current id/revision and complete details. Existing details longer than 8000 characters must be edited in the Calendar view.',
    'write',
    {
      ...record,
      title: text,
      date: text,
      startTime: nullableText,
      endTime: nullableText,
      details: text,
    },
    ['title', 'date', 'startTime', 'endTime', 'details'],
  ),
  ...(['Note', 'Task', 'Event'] as const).map((kind) =>
    tool(
      `delete${kind}`,
      `Propose deleting an existing ${kind.toLowerCase()}; requires the current id and revision.`,
      'write',
      record,
      ['id', 'revision'],
    ),
  ),
]

export function validateOrganizerArguments(id: string, args: Args): void {
  const definition = ORGANIZER_TOOLS.find((item) => item.id === id)
  if (!definition) throw new Error('Unknown organizer tool')
  const properties = definition.inputSchema.properties as Args
  const required = definition.inputSchema.required as string[]
  if (
    Object.keys(args).some((key) => !Object.hasOwn(properties, key)) ||
    required.some((key) => !Object.hasOwn(args, key))
  )
    throw new Error('Missing or unsupported tool arguments')
  for (const [key, value] of Object.entries(args)) {
    if (
      ['id', 'title', 'body', 'details', 'query', 'find', 'replace'].includes(key) &&
      typeof value !== 'string'
    )
      throw new Error(`Invalid ${key}`)
    if (
      ['date', 'dateFrom', 'dateTo'].includes(key) &&
      (typeof value !== 'string' || !isOrganizerDate(value))
    )
      throw new Error(`Invalid ${key}; use YYYY-MM-DD`)
    if (
      key === 'dueDate' &&
      value !== null &&
      (typeof value !== 'string' || !isOrganizerDate(value))
    )
      throw new Error('Invalid dueDate')
    if (
      ['startTime', 'endTime'].includes(key) &&
      value !== null &&
      (typeof value !== 'string' || !isOrganizerTime(value))
    )
      throw new Error(`Invalid ${key}; use HH:mm or null`)
    if (key === 'completed' && typeof value !== 'boolean') throw new Error('Invalid completed')
    if (
      key === 'kind' &&
      (typeof value !== 'string' ||
        !['notes', 'tasks', 'events', ...(id.endsWith('.search') ? ['all'] : [])].includes(
          String(value),
        ))
    )
      throw new Error('Invalid organizer kind')
    if (
      ['revision', 'limit', 'offset'].includes(key) &&
      (!Number.isSafeInteger(value) || Number(value) < (key === 'offset' ? 0 : 1))
    )
      throw new Error(`Invalid ${key}`)
  }
  const maximumLimit = id === 'organizer.get' ? READ_PAGE_LIMIT : 30
  if (args.limit !== undefined && Number(args.limit) > maximumLimit)
    throw new Error(`Limit must be at most ${maximumLimit}`)
  if (id === 'organizer.editNote') {
    if (!String(args.find).length) throw new Error('find must be a nonempty exact excerpt')
    if (
      String(args.find).length > ORGANIZER_LIMITS.noteBody ||
      String(args.replace).length > ORGANIZER_LIMITS.noteBody
    )
      throw new Error('Note edit is too large')
  }
  if (
    typeof args.title === 'string' &&
    (!args.title.trim() || args.title.length > ORGANIZER_LIMITS.title)
  )
    throw new Error('Invalid title')
  if (typeof args.body === 'string' && args.body.length > ORGANIZER_LIMITS.noteBody)
    throw new Error('Note body is too large')
  if (typeof args.details === 'string' && args.details.length > ORGANIZER_LIMITS.eventDetails)
    throw new Error('Event details are too large')
  if (id.includes('.save') && (args.id === undefined) !== (args.revision === undefined))
    throw new Error('An update needs both id and revision')
  if (
    id === 'organizer.saveEvent' &&
    (args.startTime === null
      ? args.endTime !== null
      : args.endTime !== null && String(args.endTime) <= String(args.startTime))
  )
    throw new Error('Event end time must follow its start time')
  if (args.dateFrom && args.dateTo && String(args.dateFrom) > String(args.dateTo))
    throw new Error('Date range is reversed')
}

export async function runOrganizerTool(
  organizer: Organizer,
  id: string,
  args: Args,
): Promise<Pick<SkillAction, 'result' | 'targets'>> {
  validateOrganizerArguments(id, args)
  if (id === 'organizer.search' || id === 'organizer.get') {
    const data = await organizer.list()
    if (id === 'organizer.get') {
      const kind = args.kind as keyof OrganizerSnapshot
      const item = data[kind].find((entry) => entry.id === args.id)
      if (!item) throw new Error('Organizer item no longer exists')
      const offset = Number(args.offset ?? 0)
      const limit = Number(args.limit ?? READ_PAGE_LIMIT)
      const content = 'body' in item ? item.body : 'details' in item ? item.details : null
      if (offset > (content?.length ?? 0)) throw new Error('Offset exceeds item text length')
      const end = content === null ? 0 : Math.min(content.length, offset + limit)
      const hasMore = content !== null && end < content.length
      const entry = {
        kind,
        ...('body' in item ? { bodyOffset: offset, bodyLength: item.body.length } : {}),
        ...('details' in item ? { detailsOffset: offset, detailsLength: item.details.length } : {}),
        truncated: content !== null && (offset > 0 || hasMore),
        hasMore,
        ...(hasMore ? { nextOffset: end } : {}),
        ...item,
        ...('body' in item ? { body: item.body.slice(offset, end) } : {}),
        ...('details' in item ? { details: item.details.slice(offset, end) } : {}),
      }
      return {
        result: JSON.stringify({
          total: 1,
          offset,
          hasMore,
          ...(hasMore ? { nextOffset: end } : {}),
          items: [entry],
        }),
        targets: [{ kind, id: item.id }],
      }
    }
    const kinds =
      args.kind && args.kind !== 'all'
        ? [args.kind as keyof OrganizerSnapshot]
        : (['events', 'tasks', 'notes'] as const)
    const query = String(args.query ?? '').toLocaleLowerCase()
    const matches = kinds
      .flatMap((kind) => data[kind].map((item) => ({ kind, ...item })))
      .filter((item) => {
        const date = 'date' in item ? item.date : 'dueDate' in item ? item.dueDate : null
        if (args.dateFrom && (!date || date < String(args.dateFrom))) return false
        if (args.dateTo && (!date || date > String(args.dateTo))) return false
        if (
          args.completed !== undefined &&
          (!('completed' in item) || item.completed !== args.completed)
        )
          return false
        return (
          !query ||
          [item.title, 'body' in item ? item.body : '', 'details' in item ? item.details : '']
            .join('\n')
            .toLocaleLowerCase()
            .includes(query)
        )
      })
      .sort((a, b) => {
        const left =
          'date' in a
            ? `${a.date} ${a.startTime ?? ''}`
            : 'dueDate' in a
              ? (a.dueDate ?? '9999')
              : a.updatedAt
        const right =
          'date' in b
            ? `${b.date} ${b.startTime ?? ''}`
            : 'dueDate' in b
              ? (b.dueDate ?? '9999')
              : b.updatedAt
        return left.localeCompare(right) || a.id.localeCompare(b.id)
      })
    const offset = Number(args.offset ?? 0)
    const selected = matches.slice(offset, offset + Number(args.limit ?? 12))
    const items: Args[] = []
    let size = 0
    for (const item of selected) {
      const limit = 500
      const entry = {
        ...item,
        ...('body' in item
          ? { body: item.body.slice(0, limit), truncated: item.body.length > limit }
          : {}),
        ...('details' in item
          ? { details: item.details.slice(0, limit), truncated: item.details.length > limit }
          : {}),
      }
      const bytes = JSON.stringify(entry).length
      if (items.length && size + bytes > 12000) break
      items.push(entry)
      size += bytes
    }
    return {
      result: JSON.stringify({
        total: matches.length,
        offset,
        hasMore: offset + items.length < matches.length,
        items,
      }),
      targets: items.map((item) => ({
        kind: item.kind as keyof OrganizerSnapshot,
        id: String(item.id),
      })),
    }
  }
  const operation = id.slice('organizer.'.length)
  const kind = operation.endsWith('Note')
    ? 'notes'
    : operation.endsWith('Task')
      ? 'tasks'
      : 'events'
  // Resolve references again at execution time. The service checks revisions
  // inside its serialized durable write, closing the gap after this read.
  const existing =
    args.id === undefined
      ? undefined
      : (await organizer.list())[kind].find((item) => item.id === args.id)
  if (args.id !== undefined) {
    if (!existing || existing.revision !== args.revision)
      throw new Error('ORGANIZER_CONFLICT: Item changed or was deleted. Ask for a fresh proposal.')
  }
  if (operation === 'editNote') {
    if (!existing || !('body' in existing)) throw new Error('Organizer note no longer exists')
    const find = String(args.find)
    const start = existing.body.indexOf(find)
    if (start < 0)
      throw new Error('The exact excerpt was not found. Read the note and propose a fresh edit.')
    if (existing.body.indexOf(find, start + 1) !== -1)
      throw new Error(
        'The excerpt occurs more than once. Include enough surrounding text to identify one occurrence.',
      )
    const body =
      existing.body.slice(0, start) +
      String(args.replace) +
      existing.body.slice(start + find.length)
    if (body.length > ORGANIZER_LIMITS.noteBody) throw new Error('Edited note is too large')
    const saved = await organizer.saveNote({
      id: existing.id,
      revision: existing.revision,
      title: existing.title,
      body,
    })
    return { result: `Updated note: ${saved.title}`, targets: [{ kind: 'notes', id: saved.id }] }
  }
  if (operation === 'saveNote') {
    if (existing && 'body' in existing && existing.body.length > READ_PAGE_LIMIT)
      throw new Error(
        'This note is longer than 8000 characters. Use editNote to preserve text outside the exact excerpt.',
      )
    const saved = await organizer.saveNote(args as never)
    return { result: `Saved note: ${saved.title}`, targets: [{ kind, id: saved.id }] }
  }
  if (operation === 'saveTask') {
    const saved = await organizer.saveTask(args as never)
    return { result: `Saved task: ${saved.title}`, targets: [{ kind, id: saved.id }] }
  }
  if (operation === 'saveEvent') {
    if (existing && 'details' in existing && existing.details.length > READ_PAGE_LIMIT)
      throw new Error(
        'This event has more than 8000 characters of details. Edit it in the Calendar view to preserve the complete text.',
      )
    const saved = await organizer.saveEvent(args as never)
    return { result: `Saved calendar event: ${saved.title}`, targets: [{ kind, id: saved.id }] }
  }
  if (operation === 'deleteNote') await organizer.deleteNote(args as never)
  else if (operation === 'deleteTask') await organizer.deleteTask(args as never)
  else if (operation === 'deleteEvent') await organizer.deleteEvent(args as never)
  else throw new Error('Unsupported organizer operation')
  return { result: 'Deleted organizer item.' }
}
