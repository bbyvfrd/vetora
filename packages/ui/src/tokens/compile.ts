/**
 * Compiles the design system's tokens.json to CSS custom properties by the artifact type's grammar ("tokens.css as
 * compiled" in its reference/format.md, and the compiler its page runs): colours and shadows under
 * `:root, [data-theme="<first theme>"]`, spacing, radius, every other token family and `--font-<key>` under `:root`,
 * a class per type style, and an `@font-face` per font. The artifact publishes no tokens.css, so this is what makes
 * the component stylesheet's `var(--…)` references resolve (ADR 0003). Pure: one token file always gives one text,
 * which is how compile.test.ts tells a stale styles/tokens.css from a fresh one. Where the page would drop a value
 * silently (no theme or a second one, an alias to a missing colour, an unknown font format), this throws.
 */

export type TokenValue = string | number | Record<string, string>
export type Token = { name: string; value: TokenValue; usage?: string }
export type TokenFamily = { note?: string; tokens: Token[] }
export type TypeStyle = {
  name: string
  family?: string
  fontSize: string | number
  lineHeight?: string | number
  fontWeight?: string | number
  letterSpacing?: string | number
  fontStyle?: string
  opticalSize?: number
  sample?: string
  usage?: string
}
export type TokenFile = {
  color: { themes: { id: string; name?: string }[]; tokens: Token[] }
  type: {
    fonts?: { family: string; file: string; weight?: string; style?: string }[]
    families: Record<string, string>
    groups: { name: string; family: string; styles: TypeStyle[] }[]
  }
  spacing?: TokenFamily
  radius?: TokenFamily
  shadow?: TokenFamily
  /** Any other `{ tokens: [...] }` family (iconSize, size, zIndex, …) lands under `:root` after radius. */
  [family: string]: unknown
}

const header = `/* Compiled from tokens.json by @vetora/ui (pnpm --filter @vetora/ui tokens). Do not edit by hand: change tokens.json
   after the artifact, then recompile. */
`

/** The top level keys with a place of their own; every other `{ tokens }` family goes under `:root` after radius. */
const placedKeys = new Set(['name', 'version', 'color', 'type', 'spacing', 'radius', 'shadow'])
/** Where the font files are, relative to the compiled stylesheet: styles/ sits beside fonts/ in the package. */
const fontBase = '../'
const alias = /^\{([^{}]+)\}$/
const hex = /^#[0-9a-f]{3,8}$/i
const fontFormats: Record<string, string> = { woff2: 'woff2', woff: 'woff', ttf: 'truetype', otf: 'opentype' }

export function compileTokens(tokens: TokenFile): string {
  const themes = tokens.color.themes.map((theme) => theme.id.toLowerCase())
  const [theme, ...otherThemes] = themes
  if (theme === undefined) throw new Error('tokens.json names no colour theme')
  if (otherThemes.length > 0) {
    throw new Error(
      `compileTokens handles one theme (the app is light only, spec #9); tokens.json has ${themes.join(', ')}`,
    )
  }
  const colours = new Set(tokens.color.tokens.map((token) => token.name))

  const themed = [...tokens.color.tokens, ...(tokens.shadow?.tokens ?? [])].map((token) =>
    themedDeclaration(token, theme, colours),
  )

  const root: string[] = []
  for (const family of [tokens.spacing, tokens.radius]) {
    for (const token of family?.tokens ?? []) root.push(declaration(token.name, cssLength(plainValue(token))))
  }
  for (const [key, family] of Object.entries(tokens)) {
    if (placedKeys.has(key) || !isFamily(family)) continue
    for (const token of family.tokens) root.push(declaration(token.name, String(plainValue(token))))
  }
  for (const [key, stack] of Object.entries(tokens.type.families)) root.push(`--font-${key.toLowerCase()}: ${stack};`)

  const styles = tokens.type.groups.flatMap((group) =>
    group.styles.map((style) =>
      block(`.${escapeName(style.name)}`, styleDeclarations(style, style.family ?? group.family)),
    ),
  )

  const fonts = (tokens.type.fonts ?? []).map((font) => {
    const file = font.file.includes('/') ? font.file : `fonts/${font.file}`
    return block('@font-face', [
      `font-family: "${font.family}";`,
      `src: url("${fontBase}${file}") format("${fontFormat(file)}");`,
      `font-weight: ${font.weight ?? '400'};`,
      `font-style: ${font.style ?? 'normal'};`,
      'font-display: swap;',
    ])
  })

  return [header, block(`:root, [data-theme="${theme}"]`, themed), block(':root', root), ...styles, ...fonts].join('\n')
}

function isFamily(value: unknown): value is TokenFamily {
  return typeof value === 'object' && value !== null && Array.isArray((value as { tokens?: unknown }).tokens)
}

/** A name as the grammar reads it: a leading `--` or `.` stripped, a `.` inside and a leading digit CSS escaped. */
function escapeName(name: string): string {
  const escaped = name.replace(/^(--|\.)/, '').replaceAll('.', '\\.')
  return /^[0-9]/.test(escaped) ? `\\3${escaped[0]} ${escaped.slice(1)}` : escaped
}

function declaration(name: string, value: string): string {
  return `--${escapeName(name)}: ${value};`
}

/** A colour or shadow value for one theme: an alias `{token}` becomes `var(--token)`, a hex colour is lowercased. */
function themedDeclaration(token: Token, theme: string, colours: Set<string>): string {
  const raw =
    typeof token.value === 'object' ? (token.value[theme] ?? Object.values(token.value)[0]) : String(token.value)
  if (raw === undefined) throw new Error(`token ${token.name} has no value for theme ${theme}`)
  const ref = alias.exec(raw)?.[1]
  if (ref !== undefined) {
    if (!colours.has(ref)) throw new Error(`token ${token.name} aliases ${ref}, which tokens.json does not define`)
    return declaration(token.name, `var(--${escapeName(ref)})`)
  }
  return declaration(token.name, hex.test(raw) ? raw.toLowerCase() : raw)
}

/** A value that is not themed: spacing, radius, sizes, z-indexes. */
function plainValue(token: Token): string | number {
  if (typeof token.value === 'object') throw new Error(`token ${token.name} is themed; only colours and shadows are`)
  return token.value
}

/** A length as the grammar reads it: a bare number is pixels. */
function cssLength(value: string | number): string {
  return typeof value === 'number' ? `${value}px` : value
}

/** The page's compiler writes every line but the optional ones: letter spacing is always set, so a style nested in a
 *  tracked one keeps its own. */
function styleDeclarations(style: TypeStyle, family: string): string[] {
  const declarations = [`font-family: var(--font-${family.toLowerCase()});`, `font-size: ${cssLength(style.fontSize)};`]
  if (style.lineHeight !== undefined) declarations.push(`line-height: ${lineHeight(style.lineHeight)};`)
  declarations.push(`font-weight: ${fontWeight(style.fontWeight ?? 400)};`)
  declarations.push(`letter-spacing: ${style.letterSpacing === undefined ? '0' : cssLength(style.letterSpacing)};`)
  if (style.fontStyle !== undefined && style.fontStyle !== 'normal')
    declarations.push(`font-style: ${style.fontStyle};`)
  if (style.opticalSize !== undefined) declarations.push(`font-variation-settings: 'opsz' ${style.opticalSize};`)
  return declarations
}

/** A unitless number under 10 is a line height factor; anything else is a length. */
function lineHeight(value: string | number): string {
  return typeof value === 'number' && value < 10 ? String(value) : cssLength(value)
}

function fontWeight(value: string | number): string {
  if (value === 'normal') return '400'
  if (value === 'bold') return '700'
  return String(value)
}

function fontFormat(file: string): string {
  const format = fontFormats[file.slice(file.lastIndexOf('.') + 1).toLowerCase()]
  if (!format) throw new Error(`font file ${file} has no known format (woff2, woff, ttf, otf)`)
  return format
}

function block(selector: string, declarations: string[]): string {
  return `${selector} {\n${declarations.map((declaration) => `  ${declaration}`).join('\n')}\n}\n`
}
