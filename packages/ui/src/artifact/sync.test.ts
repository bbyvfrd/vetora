import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readHeader } from './bundle.js'
import { syncUp } from './sync.js'

const sources = new URL('../', import.meta.url).pathname
const savedHeader = '{"format":4,"namespace":"Vetora","components":[{"name":"AppShell"},{"name":"Toaster"}]}'
/** The artifact's icon data, which differs from the repo's copy by its format: here a marker line stands for it. */
const savedIcons = `${readFileSync(join(sources, 'icons.ts'), 'utf8')}\n// the artifact's copy\n`

describe('syncUp(), a sync up into the saved copy of the artifact (ticket #15, ADR 0005)', () => {
  let folder: string
  let src: string
  beforeEach(() => {
    folder = mkdtempSync(join(tmpdir(), 'vetora-sync-'))
    src = join(folder, 'project/components/src')
    mkdirSync(src, { recursive: true })
    writeFileSync(join(folder, 'project/components/bundle.js'), `/* @ds-bundle: ${savedHeader} */\n(function(){})();\n`)
    writeFileSync(join(src, 'icons.ts'), savedIcons)
  })
  afterEach(() => rmSync(folder, { recursive: true, force: true }))

  it('copies the component sources, the helpers and the index as they are, and none of the tests or tools', async () => {
    const { copied } = await syncUp(folder, sources)
    expect(copied).toEqual(expect.arrayContaining(['Layout.tsx', 'Button.tsx', 'util.ts', 'money.ts', 'index.ts']))
    expect(copied).not.toContain('index.test.ts')
    expect(copied).not.toContain('money.test.ts')
    expect(copied).not.toContain('tokens')
    expect(copied).not.toContain('artifact')
    for (const file of copied)
      expect(readFileSync(join(src, file), 'utf8'), file).toBe(readFileSync(join(sources, file), 'utf8'))
  })

  it('leaves the artifact’s icon data as it was: it comes down, never up', async () => {
    const { copied } = await syncUp(folder, sources)
    expect(copied).not.toContain('icons.ts')
    expect(readFileSync(join(src, 'icons.ts'), 'utf8')).toBe(savedIcons)
  })

  it('rebuilds bundle.js from what the saved copy then holds, under the header of the bundle it replaces', async () => {
    await syncUp(folder, sources)
    const bundle = readFileSync(join(folder, 'project/components/bundle.js'), 'utf8')
    expect(readHeader(bundle)).toEqual(JSON.parse(savedHeader))
    expect(bundle).toContain('vt-skip')
  })

  it('names the files the saved copy holds and the repo no longer has, to publish as removed', async () => {
    writeFileSync(join(src, 'Retired.tsx'), 'export const Retired = 1\n')
    expect((await syncUp(folder, sources)).stale).toEqual(['Retired.tsx'])
  })

  it.each([
    ['the saved bundle.js', 'project/components/bundle.js'],
    ['the artifact’s icons.ts', 'project/components/src/icons.ts'],
  ])('refuses a saved copy without %s, before copying anything', async (_, missing) => {
    rmSync(join(folder, missing))
    await expect(syncUp(folder, sources)).rejects.toThrow(/missing/)
    expect(existsSync(join(src, 'Layout.tsx'))).toBe(false)
  })

  it('refuses a saved bundle.js without the page’s header, before copying anything', async () => {
    writeFileSync(join(folder, 'project/components/bundle.js'), '(function(){})();\n')
    await expect(syncUp(folder, sources)).rejects.toThrow(/@ds-bundle/)
    expect(existsSync(join(src, 'Layout.tsx'))).toBe(false)
  })
})
