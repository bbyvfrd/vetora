import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { compileFunction } from 'node:vm'
import * as React from 'react'
import * as ReactDOM from 'react-dom'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import * as ui from '../index.js'
import { type BundleHeader, buildBundle, readHeader } from './bundle.js'

const entry = new URL('../index.ts', import.meta.url).pathname

/** A catalogue as the artifact's page reads it: the namespace and the components in the order the page shows them. */
const header: BundleHeader = {
  format: 4,
  namespace: 'Vetora',
  components: [{ name: 'Icon' }, { name: 'Button' }, { name: 'AppShell' }, { name: 'Toaster' }],
}

/**
 * Runs the bundle the way the artifact's preview frame loads it: a classic script with React and React DOM on
 * `window`. Here that is the repo's React 19; the frame's is 18.3.1, on which ticket #15 rendered every preview.
 */
function run(bundle: string): Record<string, unknown> {
  const window: Record<string, unknown> = { React, ReactDOM }
  compileFunction(bundle, ['window'])(window)
  return window.Vetora as Record<string, unknown>
}

describe('buildBundle(), the artifact’s components/bundle.js built from the sources (ticket #15, ADR 0005)', () => {
  let bundle: string
  beforeAll(async () => {
    bundle = await buildBundle(entry, header)
  })

  it('assigns window.Vetora every value the package exports, and nothing else', () => {
    expect(Object.keys(run(bundle)).sort()).toEqual(Object.keys(ui).sort())
  })

  it('starts with the header the page reads its namespace and catalogue from', () => {
    expect(bundle.split('\n')[0]).toBe(`/* @ds-bundle: ${JSON.stringify(header)} */`)
    expect(readHeader(bundle)).toEqual(header)
  })

  it('holds no </script or <!--, which would end the inline script the page writes it into', () => {
    expect(bundle).not.toMatch(/<\/script|<!--/i)
  })

  it('renders through the React on window: the bundled AppShell puts the skip link first and the page in main', () => {
    const Vetora = run(bundle)
    const AppShell = Vetora.AppShell as React.FC<Omit<ui.AppShellProps, 'children'>>
    const markup = renderToStaticMarkup(
      React.createElement(
        AppShell,
        { nav: React.createElement('nav', null, 'Rail'), skipLabel: 'Skip to content' },
        'The page',
      ),
    )
    expect(markup).toMatch(
      /^<div class="vt-app"><a class="vt-skip" href="#([^"]+)">Skip to content<\/a><nav>Rail<\/nav><main id="\1" class="vt-app-main" tabindex="-1">The page<\/main><\/div>$/,
    )
  })

  it('refuses a catalogue that names a component the sources do not export', async () => {
    const stale = { ...header, components: [...header.components, { name: 'NoSuchComponent' }] }
    await expect(buildBundle(entry, stale)).rejects.toThrow(/NoSuchComponent/)
  })

  it('refuses a namespace that is not a global’s name, which the bundle could not assign', async () => {
    await expect(buildBundle(entry, { ...header, namespace: 'vetora-ui' })).rejects.toThrow(/namespace/)
  })
})

describe('buildBundle() on sources the page could not run', () => {
  let dir: string
  /** Writes one source file into a fresh folder and returns its path. */
  function source(name: string, text: string): string {
    writeFileSync(join(dir, name), text)
    return join(dir, name)
  }
  const fixture = { format: 4, namespace: 'Vetora', components: [] } as const satisfies BundleHeader

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'vetora-bundle-'))
  })
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('refuses an import of anything but react and react-dom, which the page does not load', async () => {
    const entry = source('imports.ts', "import { z } from 'zod'\nexport const schema = z.string()\n")
    await expect(buildBundle(entry, fixture)).rejects.toThrow(/imports zod/)
  })

  it('refuses output holding <!--, which would end the inline script the page writes it into', async () => {
    const entry = source('comment.ts', "export const note = 'before <!-- after'\n")
    await expect(buildBundle(entry, fixture)).rejects.toThrow(/<!--/)
  })
})

describe('readHeader()', () => {
  it('refuses a bundle without the page’s header, which the page would read with no catalogue', () => {
    expect(() => readHeader('(function(){})();')).toThrow(/@ds-bundle/)
  })

  it.each([
    ['another format', '{"format":3,"namespace":"Vetora","components":[]}'],
    ['no namespace', '{"format":4,"components":[]}'],
    ['no catalogue', '{"format":4,"namespace":"Vetora"}'],
    ['a component without its name', '{"format":4,"namespace":"Vetora","components":[{"title":"Icon"}]}'],
  ])('refuses a header with %s, which the page could not read', (_, json) => {
    expect(() => readHeader(`/* @ds-bundle: ${json} */\n(function(){})();`)).toThrow(/header/)
  })
})
