import { test, expect } from '@playwright/test'
import { launchApp, type LaunchedApp } from './helpers/launch'
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// ADR-0006 index-scoping verification: honor .gitignore, and (no .gitignore) the
// user's top-level-dir selection. Drives the REAL app via window.api. Doc rows are
// created at import time, so we can assert on documents.list without waiting for
// embeddings — keeps this fast.

test.setTimeout(180_000)

let launched: LaunchedApp

async function registerAndUnlock(l: LaunchedApp): Promise<void> {
  const { page } = l
  await expect(page.getByRole('heading', { level: 1, name: 'Konto anlegen' })).toBeVisible()
  await page.getByLabel('Anzeigename').fill('Scope Bot')
  const pw = page.locator('input[type="password"]')
  await pw.nth(0).fill('Pass123456')
  await pw.nth(1).fill('Pass123456')
  await page.getByRole('button', { name: 'Konto anlegen' }).click()
  await expect(page.getByRole('heading', { name: 'Wiederherstellungs-Wörter' })).toBeVisible()
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Weiter' }).click()
  await expect(page.getByText(/Workspace/i).first()).toBeVisible({ timeout: 20_000 })
}

async function stubFolderPicker(l: LaunchedApp, dir: string): Promise<void> {
  await l.app.evaluate(({ dialog }, picked) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [picked] })) as never
  }, dir)
}

const api = 'window.api'

async function docTitles(l: LaunchedApp, wsId: number): Promise<string[]> {
  const docs = (await l.page.evaluate(`${api}.documents.list(${wsId})`)) as Array<{ title: string }>
  return docs.map((d) => d.title).sort()
}

test.beforeEach(async () => {
  launched = await launchApp()
  await registerAndUnlock(launched)
})
test.afterEach(async () => {
  await launched.cleanup()
})

test('honors .gitignore — ignored dir/file not indexed', async () => {
  const { page } = launched
  const repo = await mkdtemp(join(tmpdir(), 'scope-gi-'))
  await writeFile(join(repo, 'package.json'), '{"name":"gi","type":"module"}')
  await writeFile(join(repo, '.gitignore'), 'build/\ngenerated.ts\n')
  await mkdir(join(repo, 'src'), { recursive: true })
  await writeFile(join(repo, 'src', 'keep.ts'), 'export const keep = 1\n')
  await mkdir(join(repo, 'build'), { recursive: true })
  await writeFile(join(repo, 'build', 'out.ts'), 'export const out = 2\n')
  await writeFile(join(repo, 'generated.ts'), 'export const gen = 3\n')
  await writeFile(join(repo, 'README.md'), '# gi\n')
  await stubFolderPicker(launched, repo)

  const ws = (await page.evaluate(`${api}.workspaces.create('GI')`)) as { id: number }
  await page.evaluate(`${api}.workspaces.setType(${ws.id}, 'codebase')`)
  await page.evaluate(`${api}.workspaces.activate(${ws.id})`)
  const add = await page.evaluate(`${api}.workspaces.addSyncFolder(${ws.id})`)
  console.log('GI addSyncFolder', JSON.stringify(add)) // expect NO needsDirSelection (.gitignore present)
  await page.evaluate(`${api}.workspaces.syncNow(${ws.id})`)

  const titles = await docTitles(launched, ws.id)
  console.log('GI titles', JSON.stringify(titles))
  expect(titles).toContain('keep.ts')
  expect(titles).toContain('README.md')
  expect(titles).not.toContain('out.ts') // build/ gitignored
  expect(titles).not.toContain('generated.ts') // filename gitignored
})

test('no .gitignore — only selected top-level dirs indexed', async () => {
  const { page } = launched
  const repo = await mkdtemp(join(tmpdir(), 'scope-inc-'))
  await writeFile(join(repo, 'package.json'), '{"name":"inc","type":"module"}')
  await mkdir(join(repo, 'src'), { recursive: true })
  await writeFile(join(repo, 'src', 'app.ts'), 'export const app = 1\n')
  await mkdir(join(repo, 'samples'), { recursive: true })
  await writeFile(join(repo, 'samples', 'demo.ts'), 'export const demo = 1\n')
  await writeFile(join(repo, 'README.md'), '# inc\n')
  await stubFolderPicker(launched, repo)

  const ws = (await page.evaluate(`${api}.workspaces.create('INC')`)) as { id: number }
  await page.evaluate(`${api}.workspaces.setType(${ws.id}, 'codebase')`)
  await page.evaluate(`${api}.workspaces.activate(${ws.id})`)
  const add = (await page.evaluate(`${api}.workspaces.addSyncFolder(${ws.id})`)) as {
    folders: string[]
    needsDirSelection?: { folder: string; topLevelDirs: string[] }
  }
  console.log('INC addSyncFolder', JSON.stringify(add))
  // no .gitignore + codebase ⇒ picker requested with the top-level dirs
  expect(add.needsDirSelection).toBeTruthy()
  expect(add.needsDirSelection!.topLevelDirs.sort()).toEqual(['samples', 'src'])

  // user picks only 'src'
  await page.evaluate(
    `${api}.workspaces.setIndexDirs(${ws.id}, ${JSON.stringify(add.needsDirSelection!.folder)}, ['src'])`,
  )
  await page.evaluate(`${api}.workspaces.syncNow(${ws.id})`)

  const titles = await docTitles(launched, ws.id)
  console.log('INC titles', JSON.stringify(titles))
  expect(titles).toContain('app.ts') // src/ selected
  expect(titles).toContain('README.md') // root file always indexed
  expect(titles).not.toContain('demo.ts') // samples/ excluded

  // edit-after-add: getDirSelection reflects the saved choice for re-opening the picker
  const sel = (await page.evaluate(
    `${api}.workspaces.getDirSelection(${ws.id}, ${JSON.stringify(add.needsDirSelection!.folder)})`,
  )) as { topLevelDirs: string[]; selected: string[]; hasGitignore: boolean }
  console.log('INC getDirSelection', JSON.stringify(sel))
  expect(sel.hasGitignore).toBe(false)
  expect(sel.topLevelDirs.sort()).toEqual(['samples', 'src'])
  expect(sel.selected.sort()).toEqual(['src'])
})

test('nested .gitignore — deeper re-include overrides a shallower exclude', async () => {
  const { page } = launched
  const repo = await mkdtemp(join(tmpdir(), 'scope-nest-'))
  await writeFile(join(repo, 'package.json'), '{"name":"nest","type":"module"}')
  await writeFile(join(repo, '.gitignore'), '*.gen.ts\n')
  await writeFile(join(repo, 'top.gen.ts'), 'export const a = 1\n')
  await mkdir(join(repo, 'src'), { recursive: true })
  await writeFile(join(repo, 'src', '.gitignore'), '!keepme.gen.ts\nlocalonly.ts\n')
  await writeFile(join(repo, 'src', 'app.ts'), 'export const app = 1\n')
  await writeFile(join(repo, 'src', 'keepme.gen.ts'), 'export const keep = 1\n')
  await writeFile(join(repo, 'src', 'other.gen.ts'), 'export const other = 1\n')
  await writeFile(join(repo, 'src', 'localonly.ts'), 'export const local = 1\n')
  await stubFolderPicker(launched, repo)

  const ws = (await page.evaluate(`${api}.workspaces.create('NEST')`)) as { id: number }
  await page.evaluate(`${api}.workspaces.setType(${ws.id}, 'codebase')`)
  await page.evaluate(`${api}.workspaces.activate(${ws.id})`)
  const add = (await page.evaluate(`${api}.workspaces.addSyncFolder(${ws.id})`)) as {
    needsDirSelection?: unknown
  }
  // .gitignore present ⇒ no picker
  expect(add.needsDirSelection).toBeFalsy()
  await page.evaluate(`${api}.workspaces.syncNow(${ws.id})`)

  const titles = await docTitles(launched, ws.id)
  console.log('NEST titles', JSON.stringify(titles))
  expect(titles).toContain('app.ts')
  expect(titles).toContain('keepme.gen.ts') // root *.gen.ts overridden by src/!keepme.gen.ts
  expect(titles).not.toContain('other.gen.ts') // still ignored by root
  expect(titles).not.toContain('top.gen.ts') // root-level, root pattern
  expect(titles).not.toContain('localonly.ts') // excluded by src/.gitignore
})
