import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { AuthService } from '../../src/main/services/auth/AuthService'
import { OrganizerService } from '../../src/main/services/organizer/OrganizerService'

describe('Organizer encrypted vault persistence', () => {
  it('saves before lock and restores records in a fresh authenticated session', async () => {
    const temporaryRoot = resolve(tmpdir())
    const directory = await mkdtemp(join(temporaryRoot, 'loklm-organizer-'))
    const first = new AuthService(directory)
    const second = new AuthService(directory)
    try {
      await first.register({
        displayName: 'Organizer test',
        password: 'Testing12345!',
        recoveryLang: 'en',
      })
      const organizer = new OrganizerService(
        first,
        () => first.persistSnapshotIfUnlocked(),
        () => first.isUnlocked(),
      )
      const note = await organizer.saveNote({
        title: 'Private research 48c32d',
        body: 'Never stored in plaintext 920e7c',
      })
      const task = await organizer.saveTask({
        title: 'Review private research',
        dueDate: '2028-02-29',
        completed: false,
      })
      const event = await organizer.saveEvent({
        title: 'Review',
        date: '2028-02-29',
        startTime: '09:00',
        endTime: '09:30',
        details: 'Bring notes',
      })
      const disk = await readFile(join(directory, 'loklm.vault'))
      expect(disk.includes(Buffer.from(note.title))).toBe(false)
      expect(disk.includes(Buffer.from(note.body))).toBe(false)

      // Read from disk before lock() has an opportunity to persist anything.
      // A resolved Save must already have produced durable encrypted data.
      expect((await second.login('Testing12345!')).ok).toBe(true)
      const restored = new OrganizerService(
        second,
        () => second.persistSnapshotIfUnlocked(),
        () => second.isUnlocked(),
      )
      expect(await restored.list()).toEqual({ notes: [note], tasks: [task], events: [event] })
      organizer.invalidate()
      await organizer.drain()
      await first.lock()
      await expect(organizer.list()).rejects.toThrow('ORGANIZER_LOCKED')
    } finally {
      await first.lock().catch(() => undefined)
      await second.lock().catch(() => undefined)
      // This test owns only the mkdtemp-created directory under the OS temp root.
      if (
        resolve(directory).startsWith(temporaryRoot + '\\') ||
        resolve(directory).startsWith(temporaryRoot + '/')
      ) {
        await rm(directory, { recursive: true, force: true })
      }
    }
  }, 60_000)
})
