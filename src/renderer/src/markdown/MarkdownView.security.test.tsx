import { readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import katex from 'katex'
import { MarkdownView } from './MarkdownView'

// GHSA-238p-pmpm-9mq7: exercise our real remark-math -> rehype-katex ->
// ReactMarkdown path. KaTeX must not inherit trust or settings metadata.
// Restore original descriptors before assertions/cleanup, even if render throws.
function withPollutedSettings<T>(values: Record<string, unknown>, action: () => T): T {
  const saved = Object.keys(values).map(
    (key) => [key, Object.getOwnPropertyDescriptor(Object.prototype, key)] as const,
  )
  try {
    for (const [key, value] of Object.entries(values))
      Object.defineProperty(Object.prototype, key, {
        configurable: true,
        enumerable: false,
        writable: true,
        value,
      })
    return action()
  } finally {
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(Object.prototype, key, descriptor)
      else Reflect.deleteProperty(Object.prototype, key)
    }
  }
}

describe('Markdown math security and compatibility', () => {
  it.each(['trust', 'default', 'processor'] as const)(
    'keeps untrusted math links and external images inert with inherited %s',
    (property) => {
      const processor = vi.fn(() => true)
      const descriptor = Object.getOwnPropertyDescriptor(Object.prototype, property)
      const markdown = String.raw`$\href{javascript:alert(1)}{click}$

$\href{https://attacker.invalid/collect}{external}$

$\includegraphics{https://attacker.invalid/pixel.png}$

Ordinary math still works: $x^2 + 1$.`
      const view = withPollutedSettings(
        { [property]: property === 'processor' ? processor : true },
        () => render(<MarkdownView>{markdown}</MarkdownView>),
      )
      expect(Object.getOwnPropertyDescriptor(Object.prototype, property)).toEqual(descriptor)
      expect(view.container.querySelectorAll('.katex')).toHaveLength(4)
      expect(view.container.querySelector('.katex-error')).toBeNull()
      expect(view.container.querySelector('a, img, script, iframe, object, embed')).toBeNull()
      expect(view.container.querySelector('[href], [src], [onerror], [onclick]')).toBeNull()
      expect(view.container.querySelector('msup')).not.toBeNull()
      expect(processor).not.toHaveBeenCalled()
    },
  )

  it('preserves inline and display math with all inherited settings poisoned', () => {
    const processor = vi.fn(() => true)
    const markdown = String.raw`Inline $a^2+b^2=c^2$.

$$
\frac{1}{2} + \sqrt{4} = \frac{5}{2}
$$`
    const view = withPollutedSettings({ trust: true, default: true, processor }, () =>
      render(<MarkdownView>{markdown}</MarkdownView>),
    )
    expect(view.container.querySelectorAll('.katex')).toHaveLength(2)
    expect(view.container.querySelectorAll('.katex-display')).toHaveLength(1)
    expect(view.container.querySelectorAll('math')).toHaveLength(2)
    expect(view.container.querySelectorAll('mfrac')).toHaveLength(2)
    expect(view.container.querySelector('msqrt')).not.toBeNull()
    expect(view.container.querySelector('.katex-error')).toBeNull()
    expect(processor).not.toHaveBeenCalled()
  })

  it('restores prototype descriptors after an exception', () => {
    const names = ['trust', 'default', 'processor']
    const before = names.map((key) => Object.getOwnPropertyDescriptor(Object.prototype, key))
    const failure = new Error('synthetic render failure')
    expect(() =>
      withPollutedSettings({ trust: true, default: true, processor: () => true }, () => {
        throw failure
      }),
    ).toThrow(failure)
    expect(names.map((key) => Object.getOwnPropertyDescriptor(Object.prototype, key))).toEqual(
      before,
    )
  })

  it('uses the same patched KaTeX package for the renderer, rehype plugin and global CSS', () => {
    const localRequire = createRequire(import.meta.url)
    const pluginRequire = createRequire(localRequire.resolve('rehype-katex'))
    const topPackage = realpathSync(localRequire.resolve('katex/package.json'))
    const nestedPackage = realpathSync(pluginRequire.resolve('katex/package.json'))
    const metadata = JSON.parse(readFileSync(topPackage, 'utf8')) as { version: string }
    expect(nestedPackage).toBe(topPackage)
    expect(katex.version).toBe(metadata.version)
    const [major = 0, minor = 0, patch = 0] = metadata.version.split('.').map(Number)
    expect(major > 0 || minor > 18 || (minor === 18 && patch >= 2)).toBe(true)

    const css = realpathSync(localRequire.resolve('katex/dist/katex.min.css'))
    expect(css).toBe(join(dirname(topPackage), 'dist', 'katex.min.css'))
    expect(readFileSync(css, 'utf8')).toContain('.katex')
    // The app's single global CSS import must continue to resolve this package.
    expect(readFileSync(localRequire.resolve('../main.tsx'), 'utf8')).toMatch(
      /import\s+['"]katex\/dist\/katex\.min\.css['"]/u,
    )
  })
})
