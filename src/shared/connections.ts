/** Connection secrets are stored only in the encrypted account vault. */
export interface McpConnectionConfig {
  id: string
  name: string
  enabled: boolean
  transport: 'stdio' | 'http'
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  headers?: Record<string, string>
}

export type McpConnectionSummary = Omit<McpConnectionConfig, 'env' | 'headers'> & {
  secretKeys: string[]
  status: 'disconnected' | 'connecting' | 'connected' | 'error'
  error?: string
  toolCount: number
}

export interface SkillTool {
  id: string
  name: string
  description: string
  inputSchema: Record<string, unknown>
  source: 'organizer' | 'mcp'
  connectionId?: string
  effect: 'read' | 'write' | 'external'
}

export interface SkillAction {
  id: string
  toolId: string
  title: string
  effect: SkillTool['effect']
  status: 'pending' | 'running' | 'completed' | 'failed' | 'dismissed'
  arguments: Record<string, unknown>
  /** Binds the reviewed action to the advertised tool definition. */
  toolFingerprint?: string
  result?: string
  error?: string
  targets?: Array<{ kind: 'notes' | 'tasks' | 'events'; id: string }>
}

/** Only persisted IDs cross the approval boundary; arguments are read from storage. */
export interface SkillActionInput {
  workspaceId: number
  conversationId: number
  messageId: number
  actionId: string
}

export interface ConnectionsApi {
  list(): Promise<McpConnectionSummary[]>
  save(config: McpConnectionConfig): Promise<McpConnectionSummary>
  remove(id: string): Promise<void>
  connect(id: string): Promise<McpConnectionSummary>
  disconnect(id: string): Promise<void>
}

export interface SkillsApi {
  tools(): Promise<SkillTool[]>
  get(input: SkillActionInput): Promise<SkillAction>
  apply(input: SkillActionInput): Promise<SkillAction>
  dismiss(input: SkillActionInput): Promise<SkillAction>
}
