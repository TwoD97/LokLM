import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const sdkRequire = createRequire(require.resolve('node-llama-cpp'))
const gitRequire = createRequire(sdkRequire.resolve('simple-git'))
const { simpleGit } = sdkRequire('simple-git')
const { vulnerabilityCheck } = gitRequire('@simple-git/argv-parser')
const esmParser = await import(
  pathToFileURL(gitRequire.resolve('@simple-git/argv-parser').replace(/\.cjs$/, '.mjs')).href
)
const esmGit = await import(
  pathToFileURL(sdkRequire.resolve('simple-git').replace(/\.cjs$/, '.mjs')).href
)
const postcssRequire = createRequire(createRequire(require.resolve('vite')).resolve('postcss'))
const coverageRequire = createRequire(require.resolve('@vitest/coverage-v8'))
const magicastRequire = createRequire(coverageRequire.resolve('magicast'))
const { SourceMapConsumer, SourceMapGenerator, SourceNode } = postcssRequire('source-map-js')

async function removeOwnedTemporaryDirectory(directory, root) {
  const resolved = await realpath(directory)
  const child = relative(await realpath(tmpdir()), resolved)
  if (
    resolved !== root ||
    !child.startsWith('loklm-git-security-') ||
    child.includes('..') ||
    isAbsolute(child)
  ) {
    throw new Error('Temporary cleanup escaped the owned test directory')
  }
  await rm(resolved, { recursive: true, force: true })
}

describe('resolved dependency security and compatibility', () => {
  it('treats sprintf-shaped DOCX text as data without loading the CLI formatter', () => {
    // Fresh process: another test loading argparse must not make this graph
    // check appear to pass or fail. This documents reachability separately
    // from the installed formatter's precision-patch regression tests.
    const child = String.raw`
      const { createRequire } = require('node:module');
      const mammothPath = require.resolve('mammoth');
      const mammothRequire = createRequire(mammothPath);
      const JSZip = mammothRequire('jszip');
      const mammoth = require(mammothPath);
      (async () => {
        const zip = new JSZip();
        zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
        zip.file('_rels/.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
        zip.file('word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Literal %.101f and %.0g remain document text.</w:t></w:r></w:p></w:body></w:document>');
        const result = await mammoth.convertToMarkdown({ buffer: await zip.generateAsync({ type: 'nodebuffer' }) });
        const loaded = Object.keys(require.cache).map(p => p.replace(/\\/g, '/'));
        process.stdout.write(JSON.stringify({ value: result.value, argparseLoaded: loaded.some(p => p.includes('/argparse/')), sprintfLoaded: loaded.some(p => p.includes('/sprintf-js/')) }));
      })().catch(() => { process.exitCode = 1; });
    `
    const output = execFileSync(process.execPath, ['-e', child], {
      cwd: dirname(require.resolve('../../../package.json')),
      timeout: 10_000,
      windowsHide: true,
      encoding: 'utf8',
      env: { ...process.env, NODE_OPTIONS: '', NODE_PATH: '' },
    })
    expect(JSON.parse(output)).toEqual({
      value: 'Literal %\\.101f and %\\.0g remain document text\\.\n\n',
      argparseLoaded: false,
      sprintfLoaded: false,
    })
  }, 15_000)

  it('keeps the SDK named Git import and supported full options working without a remote URL', async () => {
    // Local repositories only: no network endpoint, recursive submodule, native
    // model initialization, SDK build, or shared Git configuration is touched.
    const directory = await mkdtemp(join(tmpdir(), 'loklm-git-security-'))
    const root = await realpath(directory)
    try {
      const source = join(root, 'source')
      const clone = join(root, 'clone')
      const bundleClone = join(root, 'bundle-clone')
      const template = join(root, 'empty-template')
      const globalConfig = join(root, 'gitconfig')
      await mkdir(source)
      await mkdir(template)
      const safeConfig = `[core]\n\thooksPath = "${template.replaceAll('\\', '/')}"\n[init]\n\ttemplateDir = "${template.replaceAll('\\', '/')}"\n[protocol]\n\tallow = never\n[protocol "file"]\n\tallow = always\n`
      await writeFile(globalConfig, safeConfig)
      // Explicit config-path opt-in is restricted to this newly created file,
      // not a blanket unsafe setting. No ambient Git config/repository/editor
      // variables are passed to either native Git or simple-git subprocesses.
      expect(await realpath(globalConfig)).toBe(join(root, 'gitconfig'))
      expect(await readFile(globalConfig, 'utf8')).toBe(safeConfig)
      const env = Object.fromEntries(
        Object.entries(process.env).filter(
          ([key]) => !/^GIT_/i.test(key) && !/^(EDITOR|VISUAL|PAGER|SSH_ASKPASS)$/i.test(key),
        ),
      )
      Object.assign(env, {
        HOME: root,
        USERPROFILE: root,
        XDG_CONFIG_HOME: root,
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: globalConfig,
      })
      const safeOptions = {
        allowEnvironment: ['GIT_CONFIG_NOSYSTEM', 'GIT_CONFIG_GLOBAL'],
        unsafe: { allowUnsafeConfigPaths: true },
      }
      const git = (args) =>
        execFileSync('git', args, { cwd: source, env, stdio: 'pipe', windowsHide: true })
      git(['init', '--initial-branch=fixture', `--template=${template}`])
      await writeFile(join(source, '.gitattributes'), '*.txt text eol=lf\n')
      await writeFile(join(source, 'fixture.txt'), 'before\n')
      git(['add', 'fixture.txt', '.gitattributes'])
      git([
        '-c',
        'user.name=Dependency test',
        '-c',
        'user.email=dependency@example.invalid',
        '-c',
        'commit.gpgSign=false',
        'commit',
        '-m',
        'Synthetic fixture',
      ])
      const bundle = join(root, 'fixture.bundle')
      git(['bundle', 'create', bundle, '--all'])

      // These are the constructor/options shapes used by cloneLlamaCppRepo.js.
      await simpleGit({ ...safeOptions, progress() {} })
        .env(env)
        .clone(source, clone, {
          '--depth': 1,
          '--branch': 'fixture',
          '--recursive': null,
          '--quiet': null,
        })
      await simpleGit(safeOptions).env(env).clone(bundle, bundleClone, { '--quiet': null })
      await simpleGit(bundleClone, safeOptions).env(env).removeRemote('origin')
      expect(await simpleGit(bundleClone, safeOptions).env(env).getRemotes()).toEqual([])
      expect(await readFile(join(clone, 'fixture.txt'), 'utf8')).toBe('before\n')

      const patch = join(root, 'fixture.patch')
      await writeFile(
        patch,
        'diff --git a/fixture.txt b/fixture.txt\n--- a/fixture.txt\n+++ b/fixture.txt\n@@ -1 +1 @@\n-before\n+after\n',
      )
      await simpleGit({ ...safeOptions, baseDir: clone })
        .env(env)
        .applyPatch(patch, { '--ignore-whitespace': null })
      expect(await readFile(join(clone, 'fixture.txt'), 'utf8')).toBe('after\n')

      // Import the SDK's actual modules without invoking their download/build API.
      const sdkRoot = dirname(sdkRequire.resolve('node-llama-cpp'))
      const cloneModule = await import(
        pathToFileURL(join(sdkRoot, 'bindings/utils/cloneLlamaCppRepo.js')).href
      )
      const patchModule = await import(
        pathToFileURL(join(sdkRoot, 'bindings/utils/applyLlamaCppRepoPatches.js')).href
      )
      expect(typeof cloneModule.cloneLlamaCppRepo).toBe('function')
      expect(typeof patchModule.applyLlamaCppRepoPatches).toBe('function')
    } finally {
      await removeOwnedTemporaryDirectory(directory, root)
    }
  }, 20_000)

  it.each([
    [['status'], { VISUAL: 'synthetic-editor' }, 'allowUnsafeEditor'],
    [['-c', 'trailer.test.cmd=synthetic-command', 'status'], {}, 'allowUnsafeCommandBinaries'],
    [['rebase', '-x', 'synthetic-command'], {}, 'allowUnsafeExec'],
    [['rebase', '--exec=synthetic-command'], {}, 'allowUnsafeExec'],
    [['clone', '--upl=synthetic-command', 'synthetic-local'], {}, 'allowUnsafePack'],
    [['-c', 'include.path=synthetic-config', 'status'], {}, 'allowUnsafeInclude'],
    [
      ['-c', 'includeIf.gitdir:synthetic.path=synthetic-config', 'status'],
      {},
      'allowUnsafeInclude',
    ],
    [['push', '--receive-p=synthetic-command'], {}, 'allowUnsafePack'],
    [['push', '--exe=synthetic-command'], {}, 'allowUnsafePack'],
    [['rebase', '--exe=synthetic-command'], {}, 'allowUnsafeExec'],
  ])('recognizes unsafe Git input %j before spawning a command', (args, env, category) => {
    expect(vulnerabilityCheck(args, env).map((entry) => entry.category)).toContain(category)
  })

  it('rejects unsafe trailer configuration at the real simple-git boundary', async () => {
    // A nonexistent binary guarantees that this probe cannot execute a payload
    // even if the admission regression returns. Rejection must be the guard.
    await expect(
      simpleGit({ binary: 'loklm-nonexistent-security-probe' }).raw([
        '-c',
        'trailer.test.cmd=synthetic-command',
        'status',
      ]),
    ).rejects.toThrow(/allowUnsafeCommandBinaries/)
  })

  describe.each([
    ['CJS', vulnerabilityCheck, simpleGit],
    ['ESM', esmParser.vulnerabilityCheck, esmGit.simpleGit],
  ])('%s push abbreviation patch', (_entry, check, createGit) => {
    it('rejects every command-option prefix with attached and separate values', () => {
      for (const option of ['--receive-pack', '--exec']) {
        for (let length = 3; length <= option.length; length++) {
          const prefix = option.slice(0, length)
          for (const args of [
            [`push`, `${prefix}=synthetic-command`],
            ['push', prefix, 'synthetic-command'],
          ]) {
            expect(check(args, {}).map((entry) => entry.category)).toContain('allowUnsafePack')
          }
        }
      }
    })

    it.each([
      ['--push-option', '--', '--exe=synthetic-command'],
      ['--pu', '--', '--receive-p=synthetic-command'],
      ['--rep', '--', '--exe=synthetic-command'],
      ['-o', '--', '--exe=synthetic-command'],
      ['-o--', '--exe=synthetic-command'],
      ['-vo', '--', '--exe=synthetic-command'],
      ['-qo--', '--exe=synthetic-command'],
      ['--force-with-lease', '--exe=synthetic-command'],
      ['--signed', '--exe=synthetic-command'],
    ])('does not mistake a required value for the end marker: %j', (...args) => {
      expect(check(['push', ...args], {}).map((entry) => entry.category)).toContain(
        'allowUnsafePack',
      )
    })

    it.each([
      ['push', '--', '--exe=literal'],
      ['push', '--repo', '--exe=literal'],
      ['push', '--rep', '--receive-p=literal'],
      ['push', '--repo=--exe=literal'],
      ['push', '--push-option', '--exe=literal'],
      ['push', '-o--exe=literal'],
      ['push', '-ov', '--', '--exe=literal'],
      ['push', '-vqo--exe=literal'],
      ['push', '--recurse-submodules', 'on-demand', '--force-with-lease', 'origin', 'HEAD'],
      ['push', '--recu=on-demand', '--repo=origin', '--force-with-lease=HEAD:synthetic'],
      ['push', '--signed', '--', '--exe=literal'],
      ['push', '--force-with-lease', '--', '--receive-p=literal'],
      ['commit', '--message', '--exe=literal'],
    ])('preserves ordinary flags, values, and genuine end markers: %j', (...args) => {
      expect(check(args, {})).toEqual([])
    })

    it('guards the real entry point before spawn and preserves explicit opt-in', async () => {
      const options = { binary: 'loklm-nonexistent-security-probe' }
      for (const flag of ['--receive-p', '--exe']) {
        await expect(createGit(options).raw(['push', `${flag}=synthetic-command`])).rejects.toThrow(
          /allowUnsafePack/,
        )
        // No binary exists, so explicit opt-in can only reach safe ENOENT.
        await expect(
          createGit({ ...options, unsafe: { allowUnsafePack: true } }).raw([
            'push',
            `${flag}=synthetic-command`,
          ]),
        ).rejects.toThrow(/ENOENT/)
      }
    })
  })

  const flat = {
    version: 3,
    sources: ['fixture.ts'],
    names: [],
    mappings: 'AAAA',
    sourcesContent: ['x'],
  }
  const indexed = (line, map = flat, column = 0) => ({
    version: 3,
    sections: [{ offset: { line, column }, map }],
  })

  it('tests the same fixed source-map package used by the affected coverage/magicast chain', () => {
    expect(magicastRequire.resolve('source-map-js')).toBe(postcssRequire.resolve('source-map-js'))
    expect(magicastRequire('source-map-js/package.json').version).toBe('1.2.2')
  })

  it.each([-1, 0.5, '2', Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid indexed source offset %s',
    (line) => {
      expect(() => new SourceMapConsumer(indexed(line))).toThrow(/non-negative integers/)
    },
  )

  it('rejects excessive direct and cumulative offsets before generator expansion', () => {
    expect(() => new SourceMapConsumer(indexed(100_000_000))).toThrow(/must not exceed/)
    expect(() => new SourceMapConsumer(indexed(6_000_000, indexed(6_000_000)))).toThrow(
      /nested sections/,
    )
  })

  it('retains normal map round trips and does not invent text after generated input ends', () => {
    const consumer = new SourceMapConsumer(indexed(2))
    const mappings = []
    consumer.eachMapping((mapping) => mappings.push(mapping))
    expect(mappings).toMatchObject([{ source: 'fixture.ts', generatedLine: 3, originalLine: 1 }])
    const roundTrip = new SourceMapConsumer(
      SourceMapGenerator.fromSourceMap(new SourceMapConsumer(flat)).toJSON(),
    )
    expect(roundTrip.originalPositionFor({ line: 1, column: 0 })).toMatchObject({
      source: 'fixture.ts',
      line: 1,
    })
    expect(SourceNode.fromStringWithSourceMap('x', consumer).toString()).toBe('x')
  })
})
