import type { AuthService } from '../auth/AuthService'
import type { Workspace } from '../../db/schema'

const NAME_MIN = 1
const NAME_MAX = 128

export class WorkspaceService {
  constructor(private readonly auth: AuthService) {}

  async list(): Promise<Workspace[]> {
    return this.auth.requireDatabase().workspaces().list()
  }

  async create(name: string): Promise<Workspace> {
    this.validateName(name)
    return this.auth.requireDatabase().workspaces().create(name.trim())
  }

  async rename(id: number, name: string): Promise<void> {
    this.validateName(name)
    await this.auth.requireDatabase().workspaces().rename(id, name.trim())
  }

  async delete(id: number): Promise<void> {
    await this.auth.requireDatabase().workspaces().delete(id)
  }

  private validateName(name: string): void {
    const trimmed = name?.trim() ?? ''
    if (trimmed.length < NAME_MIN || trimmed.length > NAME_MAX) {
      throw new Error(`Workspace name must be ${NAME_MIN}-${NAME_MAX} chars`)
    }
  }
}
