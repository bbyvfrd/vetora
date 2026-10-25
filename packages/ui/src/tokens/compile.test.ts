import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { compileTokens, type TokenFile } from './compile.js'
import tokens from './tokens.json' with { type: 'json' }

const stylesDir = new URL('../../styles/', import.meta.url)
const committed = readFileSync(new URL('tokens.css', stylesDir), 'utf8')
const components = readFileSync(new URL('components.css', stylesDir), 'utf8')

/** The custom property names declared inside one `selector { … }` block of a stylesheet. */
function declared(css: string, selector: string): string[] {
  const start = css.indexOf(`${selector} {`)
  if (start < 0) throw new Error(`${selector} is not in the stylesheet`)
  return css.slice(start, css.indexOf('\n}', start)).match(/--[\w-]+(?=:)/g) ?? []
}

const propertyNames = (family?: { tokens: { name: string }[] }) => (family?.tokens ?? []).map((t) => `--${t.name}`)

/** One of everything the grammar names, small enough to write its compiled form by hand. */
const fixture: TokenFile = {
  color: {
    themes: [{ id: 'Light' }],
    tokens: [
      { name: 'ink', value: '#0A014F' },
      { name: 'text', value: '{ink}' },
      { name: 'scrim', value: 'rgba(10, 1, 79, 0.48)' },
    ],
  },
  shadow: { tokens: [{ name: 'shadow-sm', value: '0 1px 2px rgba(10, 1, 79, 0.08)' }] },
  spacing: { tokens: [{ name: 'space-1.5', value: 6 }] },
  radius: { tokens: [{ name: 'radius-md', value: '8px' }] },
  zIndex: { tokens: [{ name: 'z-toast', value: '1300' }] },
  type: {
    fonts: [{ family: 'Roboto', file: 'Roboto-Variable.woff2', weight: '100 900', style: 'normal' }],
    families: { Sans: '"Roboto", sans-serif' },
    groups: [
      {
        name: 'Text',
        family: 'Sans',
        styles: [
          { name: 'body', fontSize: 14, lineHeight: 20, fontWeight: 400 },
          {
            name: '2xl',
            fontSize: '32px',
            lineHeight: 1.25,
            fontWeight: 'bold',
            letterSpacing: '-0.01em',
            fontStyle: 'italic',
            opticalSize: 32,
          },
        ],
      },
    ],
  },
}

const fixtureCss = `/* Compiled from tokens.json by @vetora/ui (pnpm --filter @vetora/ui tokens). Do not edit by hand: change tokens.json
   after the artifact, then recompile. */

:root, [data-theme="light"] {
  --ink: #0a014f;
  --text: var(--ink);
  --scrim: rgba(10, 1, 79, 0.48);
  --shadow-sm: 0 1px 2px rgba(10, 1, 79, 0.08);
}

:root {
  --space-1\\.5: 6px;
  --radius-md: 8px;
  --z-toast: 1300;
  --font-sans: "Roboto", sans-serif;
}

.body {
  font-family: var(--font-sans);
  font-size: 14px;
  line-height: 20px;
  font-weight: 400;
  letter-spacing: 0;
}

.\\32 xl {
  font-family: var(--font-sans);
  font-size: 32px;
  line-height: 1.25;
  font-weight: 700;
  letter-spacing: -0.01em;
  font-style: italic;
  font-variation-settings: 'opsz' 32;
}

@font-face {
  font-family: "Roboto";
  src: url("../fonts/Roboto-Variable.woff2") format("woff2");
  font-weight: 100 900;
  font-style: normal;
  font-display: swap;
}
`

describe('compileTokens(), the artifact type’s grammar', () => {
  it('writes the themed block, the root block, a class per type style and the font faces as the page does', () => {
    expect(compileTokens(fixture)).toBe(fixtureCss)
  })

  it.each([
    ['no colour theme', (t: TokenFile) => (t.color.themes = []), /no colour theme/],
    ['a second theme', (t: TokenFile) => t.color.themes.push({ id: 'dark' }), /one theme/],
    [
      'an alias to a missing colour',
      (t: TokenFile) => t.color.tokens.push({ name: 'ghost', value: '{nothing}' }),
      /does not define/,
    ],
    [
      'a themed value outside colours and shadows',
      (t: TokenFile) => (t.radius = { tokens: [{ name: 'radius-md', value: { light: '8px' } }] }),
      /themed/,
    ],
    [
      'a font of unknown format',
      (t: TokenFile) => (t.type.fonts = [{ family: 'Roboto', file: 'Roboto.eot' }]),
      /no known format/,
    ],
  ])('refuses %s, which the artifact’s page would drop silently', (_, change, message) => {
    const changed = structuredClone(fixture)
    change(changed)
    expect(() => compileTokens(changed)).toThrow(message)
  })
})

describe('styles/tokens.css, compiled from tokens.json (spec #9, seam 2)', () => {
  it('is what compileTokens() produces from the committed tokens.json, so a stale file fails', () => {
    expect(committed).toBe(compileTokens(tokens))
  })

  it('tells a token changed without recompiling from the committed file', () => {
    const changed = structuredClone(tokens)
    for (const token of changed.color.tokens) if (token.name === 'primary-hover') token.value = '#000000'
    expect(compileTokens(changed)).not.toBe(committed)
  })

  it('puts every colour and shadow under the root and the light theme', () => {
    expect(declared(committed, ':root, [data-theme="light"]')).toEqual([
      ...propertyNames(tokens.color),
      ...propertyNames(tokens.shadow),
    ])
  })

  it('puts spacing, radius, icon sizes, sizes, z-indexes and the font stack under the root', () => {
    expect(declared(committed, ':root')).toEqual([
      ...propertyNames(tokens.spacing),
      ...propertyNames(tokens.radius),
      ...propertyNames(tokens.iconSize),
      ...propertyNames(tokens.size),
      ...propertyNames(tokens.zIndex),
      '--font-sans',
    ])
  })

  it('has a class per type style', () => {
    for (const group of tokens.type.groups) {
      for (const style of group.styles) expect(committed).toContain(`\n.${style.name} {\n`)
    }
  })

  it('serves Roboto from the package: one variable @font-face, swapped in, pointing at the packaged file', () => {
    const faces = committed.match(/@font-face \{[^}]*\}/g) ?? []
    expect(faces).toHaveLength(1)
    expect(faces[0]).toContain('font-family: "Roboto";')
    expect(faces[0]).toContain('font-weight: 100 900;')
    expect(faces[0]).toContain('font-display: swap;')
    const fontUrl = /src: url\("([^"]+)"\)/.exec(faces[0] ?? '')?.[1]
    expect(fontUrl).toBe('../fonts/Roboto-Variable.woff2')
    expect(existsSync(new URL(fontUrl ?? '', stylesDir))).toBe(true)
  })
})

describe('styles/components.css, the stylesheet copied from the artifact', () => {
  it('reads only custom properties that tokens.css or the stylesheet itself defines', () => {
    const defined = new Set(
      [...committed.matchAll(/(--[\w-]+)\s*:/g), ...components.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]),
    )
    const referenced = new Set([...components.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]))
    const unresolved = [...referenced].filter((name) => !defined.has(name)).sort()
    // The schedule's column, slot and per hour counts and the tooltip's shift are set inline by Schedule.tsx and
    // Tooltip.tsx from their props: the only variables no stylesheet declares.
    expect(unresolved).toEqual(['--vt-cols', '--vt-per-hour', '--vt-slots', '--vt-tip-shift'])
  })
})
