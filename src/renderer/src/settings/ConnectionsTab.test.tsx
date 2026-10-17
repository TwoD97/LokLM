import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { McpConnectionSummary } from '@shared/connections'
import { ConnectionsTab } from './ConnectionsTab'
import { SettingsModal } from './SettingsModal'

const connection: McpConnectionSummary = {
  id: 'mail',
  name: 'My mail',
  enabled: true,
  transport: 'stdio',
  command: 'mail-mcp',
  args: ['--readonly'],
  secretKeys: ['ACCESS_TOKEN'],
  status: 'disconnected',
  toolCount: 0,
}
afterEach(() => vi.restoreAllMocks())

async function loaded() {
  render(<ConnectionsTab />)
  await waitFor(() => expect(screen.queryByText('Loading connections…')).toBeNull())
}

describe('MCP connection settings', () => {
  it('saves Fastmail credentials through a dedicated password field without connecting', async () => {
    const save = vi.spyOn(window.api.connections, 'save').mockResolvedValue(connection)
    const connect = vi.spyOn(window.api.connections, 'connect')
    await loaded()
    fireEvent.click(screen.getByRole('button', { name: 'Fastmail' }))
    const token = screen.getByLabelText('Fastmail API token')
    expect(token).toHaveAttribute('type', 'password')
    expect(screen.queryByLabelText('Command')).toBeNull()
    expect(screen.getByRole('link', { name: 'Create a Fastmail API token' })).toHaveAttribute(
      'href',
      'https://app.fastmail.com/settings/security/tokens',
    )
    fireEvent.change(token, { target: { value: 'my-private-token' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save connection' }))
    await screen.findByText('Connection saved.')
    expect(save).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ transport: 'fastmail', env: { API_TOKEN: 'my-private-token' } }),
    )
    expect(save.mock.calls[0]![0]).not.toHaveProperty('headers')
    expect(connect).not.toHaveBeenCalled()
    expect(screen.queryByDisplayValue('my-private-token')).toBeNull()
  })

  it('saves CouchDB and LiveSync credentials separately, with an explicit database URL', async () => {
    const save = vi.spyOn(window.api.connections, 'save').mockResolvedValue(connection)
    await loaded()
    fireEvent.click(screen.getByRole('button', { name: 'Obsidian / CouchDB' }))
    fireEvent.change(screen.getByLabelText('CouchDB database URL'), {
      target: { value: 'https://notes.example/vault' },
    })
    fireEvent.change(screen.getByLabelText('CouchDB username'), { target: { value: 'user' } })
    fireEvent.change(screen.getByLabelText('CouchDB password'), { target: { value: 'password' } })
    fireEvent.change(screen.getByLabelText('LiveSync encryption passphrase'), {
      target: { value: 'separate-passphrase' },
    })
    expect(screen.getByLabelText('LiveSync encryption passphrase')).toHaveAttribute(
      'type',
      'password',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Save connection' }))
    await screen.findByText('Connection saved.')
    expect(save).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        transport: 'couchdb',
        url: 'https://notes.example/vault',
        env: {
          COUCHDB_USERNAME: 'user',
          COUCHDB_PASSWORD: 'password',
          LIVESYNC_PASSPHRASE: 'separate-passphrase',
        },
      }),
    )
    expect(screen.queryByDisplayValue('separate-passphrase')).toBeNull()
  })

  it('preserves stored native secrets when editing blank fields', async () => {
    vi.spyOn(window.api.connections, 'list').mockResolvedValue([
      { ...connection, transport: 'fastmail', secretKeys: ['env:API_TOKEN'] },
    ])
    const save = vi.spyOn(window.api.connections, 'save').mockResolvedValue(connection)
    await loaded()
    fireEvent.click(screen.getByRole('button', { name: 'Edit connection' }))
    expect(screen.getByLabelText('Fastmail API token')).toHaveValue('')
    fireEvent.click(screen.getByRole('button', { name: 'Save connection' }))
    await screen.findByText('Connection saved.')
    expect(save.mock.calls[0]![0]).not.toHaveProperty('env')
  })

  it('clears typed secrets when switching connector types', async () => {
    const save = vi.spyOn(window.api.connections, 'save').mockResolvedValue(connection)
    await loaded()
    fireEvent.click(screen.getByRole('button', { name: 'Fastmail' }))
    fireEvent.change(screen.getByLabelText('Fastmail API token'), {
      target: { value: 'do-not-forward' },
    })
    fireEvent.change(screen.getByLabelText('Connection type'), { target: { value: 'couchdb' } })
    fireEvent.change(screen.getByLabelText('CouchDB database URL'), {
      target: { value: 'https://notes.example/vault' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save connection' }))
    await screen.findByText('Connection saved.')
    expect(JSON.stringify(save.mock.calls)).not.toContain('do-not-forward')
  })

  it('offers an editable Gmail and Calendar preset without running or saving anything', async () => {
    const save = vi.spyOn(window.api.connections, 'save')
    const connect = vi.spyOn(window.api.connections, 'connect')
    await loaded()
    fireEvent.click(screen.getByRole('button', { name: 'Gmail + Google Calendar' }))
    expect(screen.getByRole('textbox', { name: 'Command' })).toHaveValue('uvx')
    expect(screen.getByRole('textbox', { name: 'Arguments (JSON array)' })).toHaveValue(
      '["workspace-mcp","--tools","gmail","calendar"]',
    )
    expect(screen.getByLabelText('Environment variables (JSON object)')).toHaveValue('')
    expect(screen.getByRole('link', { name: 'Server setup guide' })).toHaveAttribute(
      'href',
      'https://github.com/taylorwilsdon/google_workspace_mcp#quick-start',
    )
    expect(save).not.toHaveBeenCalled()
    expect(connect).not.toHaveBeenCalled()
  })
  it('opens the Connections tab from Settings', async () => {
    render(<SettingsModal open initialTab="connections" onClose={() => {}} />)
    expect(screen.getByRole('tab', { name: 'Connections' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(await screen.findByRole('button', { name: 'Add connection' })).toBeVisible()
  })

  it('reports load failure and lets the user retry', async () => {
    const list = vi
      .spyOn(window.api.connections, 'list')
      .mockRejectedValueOnce(new Error('Vault unavailable'))
      .mockResolvedValue([connection])
    await loaded()
    expect(screen.getByRole('alert')).toHaveTextContent('Vault unavailable')
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('My mail')).toBeVisible()
    expect(list).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('edits a redacted connection without overwriting credentials when the input stays blank', async () => {
    vi.spyOn(window.api.connections, 'list').mockResolvedValue([connection])
    const save = vi.spyOn(window.api.connections, 'save').mockResolvedValue(connection)
    await loaded()
    fireEvent.click(screen.getByRole('button', { name: 'Edit connection' }))
    const secrets = screen.getByLabelText('Environment variables (JSON object)')
    expect(secrets).toHaveAttribute('type', 'password')
    expect(secrets).toHaveValue('')
    expect(screen.getByText('Saved credential keys: ACCESS_TOKEN')).toBeVisible()
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), {
      target: { value: 'Renamed mail' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save connection' }))
    await screen.findByText('Connection saved.')
    expect(save).toHaveBeenCalledExactlyOnceWith({
      id: 'mail',
      name: 'Renamed mail',
      enabled: true,
      transport: 'stdio',
      command: 'mail-mcp',
      args: ['--readonly'],
    })
    expect(save.mock.calls[0]![0]).not.toHaveProperty('env')
  })

  it('rejects invalid argument JSON without discarding the draft', async () => {
    const save = vi.spyOn(window.api.connections, 'save')
    await loaded()
    fireEvent.click(screen.getByRole('button', { name: 'Add connection' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'Mail' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Command' }), {
      target: { value: 'mail-mcp' },
    })
    fireEvent.change(screen.getByRole('textbox', { name: 'Arguments (JSON array)' }), {
      target: { value: '[false]' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save connection' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Arguments must be a JSON array of strings.',
    )
    expect(save).not.toHaveBeenCalled()
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Mail')
    expect(screen.getByRole('button', { name: 'Save connection' })).toBeEnabled()
  })

  it('saves HTTP headers only on explicit entry and clears the credential editor afterward', async () => {
    const save = vi.spyOn(window.api.connections, 'save').mockResolvedValue(connection)
    await loaded()
    fireEvent.click(screen.getByRole('button', { name: 'Add connection' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), {
      target: { value: 'Calendar' },
    })
    fireEvent.change(screen.getByRole('combobox', { name: 'Connection type' }), {
      target: { value: 'http' },
    })
    fireEvent.change(screen.getByRole('textbox', { name: 'Server URL' }), {
      target: { value: 'https://calendar.example/mcp' },
    })
    fireEvent.change(screen.getByLabelText('Request headers (JSON object)'), {
      target: { value: '{"Authorization":"Bearer test-token"}' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save connection' }))
    await screen.findByText('Connection saved.')
    expect(save).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        name: 'Calendar',
        transport: 'http',
        url: 'https://calendar.example/mcp',
        headers: { Authorization: 'Bearer test-token' },
      }),
    )
    expect(screen.queryByDisplayValue(/test-token/)).toBeNull()
    expect(screen.queryByText(/test-token/)).toBeNull()
  })

  it('reconnects a disabled server once, refreshes its tools, and confirms removal', async () => {
    const list = vi
      .spyOn(window.api.connections, 'list')
      .mockResolvedValue([{ ...connection, enabled: false }])
    const tools = vi.spyOn(window.api.skills, 'tools').mockResolvedValue([])
    let finish!: (value: McpConnectionSummary) => void
    const connect = vi.spyOn(window.api.connections, 'connect').mockReturnValue(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    const remove = vi.spyOn(window.api.connections, 'remove').mockResolvedValue(undefined)
    await loaded()
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }))
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }))
    expect(connect).toHaveBeenCalledExactlyOnceWith('mail')
    list.mockResolvedValue([{ ...connection, status: 'connected', toolCount: 1 }])
    tools.mockResolvedValue([
      {
        id: 'mail.search',
        name: 'Search mail',
        description: 'Find messages',
        source: 'mcp',
        connectionId: 'mail',
        effect: 'external',
        inputSchema: {},
      },
    ])
    await act(async () => finish({ ...connection, status: 'connected', toolCount: 1 }))
    expect(await screen.findByText('Search mail')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Disconnect' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    expect(remove).not.toHaveBeenCalled()
    const dialog = screen.getByRole('dialog', { name: 'Remove connection?' })
    expect(dialog).toHaveTextContent('My mail')
    list.mockResolvedValue([])
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(remove).toHaveBeenCalledExactlyOnceWith('mail'))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('refreshes connection state on demand when an open server stops', async () => {
    const list = vi
      .spyOn(window.api.connections, 'list')
      .mockResolvedValue([{ ...connection, status: 'connected' }])
    await loaded()
    expect(screen.getByRole('button', { name: 'Disconnect' })).toBeEnabled()
    list.mockResolvedValue([{ ...connection, status: 'error', error: 'Server stopped' }])
    fireEvent.click(screen.getByRole('button', { name: 'Refresh connections' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Server stopped')
    expect(screen.getByRole('button', { name: 'Connect' })).toBeEnabled()
    expect(list).toHaveBeenCalledTimes(2)
  })
})
