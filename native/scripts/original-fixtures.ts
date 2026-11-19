// Synthetic only. Executes the actual current TS implementations; no user data.
// Run from repository root: pnpm exec tsx native/scripts/original-fixtures.ts
import { mkdir, writeFile, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { AuthService } from '../../src/main/services/auth/AuthService'
import { chunkPages, chunkMarkdown } from '../../src/main/services/documents/chunker'
import { parseMarkdownSections } from '../../src/main/services/documents/markdownParser'
import { encryptBlock } from '../../src/main/services/storage/blockCipher'

const root = await mkdtemp(join(tmpdir(), 'loklm-original-fixtures-'))
const out = resolve('native/crates/core/tests/fixtures')
await mkdir(out, { recursive: true })
const password = 'Synthetic-fixture-47!'
const auth = new AuthService(root)
const { passphrase } = await auth.register({ displayName: 'Synthetic Fixture', password, recoveryLang: 'en' })
const ws = await auth.getWorkspaceStore().create('Synthetic DE/EN')
const db = await auth.getWorkspaceDb(ws.id)
const doc = await db.addDocument({title:'Berlin / Grüße',sourcePath:'synthetic://Berlin.md',mimeType:'text/markdown',status:'ready',contentHash:'synthetic-original-v1'})
const ids = await db.persistChunks(doc.id,[{ordinal:0,text:'Berlin ist die Hauptstadt. English content. ALPHA-47.',pageFrom:2,pageTo:2,tokenCount:15,headingPath:['Reisen'],language:'de'}])
const conversation=await db.createConversation('Synthetic citations',[doc.id])
await db.appendMessage(conversation.id,'user','What is the code?')
const answer=await db.appendMessage(conversation.id,'assistant','ALPHA-47 [1]')
await db.persistCitations(answer.id,[{chunk_id:ids[0]!,score:0.75}])
// Preserve unknown/extra settings and all SQLite tables in roundtrip tests.
await auth.setKv('native-fixture', JSON.stringify({ text: 'Grüße Berlin', retained: true }))
await auth.lock()
const { copyFile } = await import('node:fs/promises')
await copyFile(join(root, 'loklm.vault'), join(out, 'original-v6.vault'))
await copyFile(join(root, 'workspaces', ws.dir, 'meta.db'), join(out, 'original-meta.db'))
const pageTexts = ['Berlin ist die Hauptstadt. English content.', 'Alpha. '.repeat(700), 'x'.repeat(4100)]
const markdown = ['---\ntitle: Fixture\n---\n# Über uns\nDeutsch und English.\n## C#\nSource content.', '# Table\n| Name | City |\n| --- | --- |\n' + Array.from({length:200}, (_,i)=>`| ${i} | Wien |`).join('\n')]
await writeFile(join(out, 'original-chunks.json'), JSON.stringify({ pages:pageTexts.map(text=>({text,chunks:chunkPages([{num:1,text}])})),markdown:markdown.map(text=>({text,chunks:chunkMarkdown(parseMarkdownSections(text))})) },null,2))
const key = Buffer.alloc(32, 7)
const plain = 'Synthetic encrypted block: Grüße / English'
await writeFile(join(out, 'original-block.bin'), encryptBlock(key, 'data/file.lance', 9, Buffer.from(plain)))
await writeFile(join(out, 'synthetic-credentials.json'), JSON.stringify({password,recovery:passphrase.join(' '),workspaceId:ws.id,blockKey:key.toString('hex'),blockPlaintext:plain},null,2))
console.log('Created synthetic original-implementation fixtures. No personal vault opened.')
