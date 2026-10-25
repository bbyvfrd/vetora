import { describe, expect, it } from 'vitest'
import type { Token } from './compile.js'
import tokens from './tokens.json' with { type: 'json' }

/**
 * Seam 2, the contrast half (spec #9, ticket #11): every text and ground pair the brand book names meets WCAG 2
 * contrast, 4.5:1 for text and 3:1 for controls and chart series, computed from relative luminance over the colour
 * tokens as data, no DOM. A pair that fails is reported on the ticket and fixed in the artifact first, then re-copied;
 * no pair is dropped to make the test pass.
 */

const forText = 4.5
const forControls = 3

/** A pair to measure: what is read or seen, the ground it sits on, and the ratio it must reach. */
type Pair = [foreground: string, ground: string, minimum: number]

/** The pairs the brand book's Colour, Status, States and Charts sections name. */
const pairs: Pair[] = [
  // Body, supporting and muted text on the three light grounds.
  ...['text', 'text-secondary', 'text-muted'].flatMap((fg) =>
    ['surface', 'surface-page', 'surface-sunken'].map((bg): Pair => [fg, bg, forText]),
  ),
  // Text on a primary fill through its hover and pressed steps.
  ['on-primary', 'primary', forText],
  ['on-primary', 'primary-hover', forText],
  ['on-primary', 'primary-pressed', forText],
  // Text on the navigation rail and tooltips.
  ['on-inverse', 'surface-inverse', forText],
  ['on-inverse-muted', 'surface-inverse', forText],
  // Each status as text on its subtle ground, and its on- colour on the solid fill.
  ...['success', 'warning', 'danger', 'info'].flatMap((status): Pair[] => [
    [status, `${status}-subtle`, forText],
    [`on-${status}`, status, forText],
  ]),
  ['link', 'surface', forText],
  // Controls: the edge of an input at rest and the keyboard focus ring.
  ['border-strong', 'surface', forControls],
  ['focus-ring', 'surface', forControls],
  // The five chart series, measured to hold 3:1 against surface.
  ['chart-1', 'surface', forControls],
  ['chart-2', 'surface', forControls],
  ['chart-3', 'surface', forControls],
  ['chart-4', 'surface', forControls],
  ['chart-5', 'surface', forControls],
]

const colours = new Map<string, Token['value']>(tokens.color.tokens.map((token) => [token.name, token.value]))

/** A colour token's value in the light theme as six hex digits, aliases followed: `{primary}` is brand-steel's. */
function hexOf(name: string): string {
  const value = colours.get(name)
  if (value === undefined) throw new Error(`tokens.json has no colour token ${name}`)
  const raw = typeof value === 'object' ? value.light : String(value)
  const alias = /^\{([^{}]+)\}$/.exec(raw)?.[1]
  if (alias !== undefined) return hexOf(alias)
  if (!/^#[0-9a-f]{6}$/i.test(raw))
    throw new Error(`${name} is ${raw}; contrast is measured between opaque hex colours`)
  return raw.toLowerCase()
}

/** WCAG 2 relative luminance of an opaque sRGB colour, 0 for black to 1 for white. */
function luminance(hex: string): number {
  const linear = (at: number) => {
    const channel = Number.parseInt(hex.slice(at, at + 2), 16) / 255
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * linear(1) + 0.7152 * linear(3) + 0.0722 * linear(5)
}

/** WCAG 2 contrast ratio of two opaque colours, 1 to 21, whichever way round they are given. */
function contrast(a: string, b: string): number {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (lighter + 0.05) / (darker + 0.05)
}

describe('contrast(), WCAG 2 from relative luminance', () => {
  it('runs from black on white at 21:1 to a colour on itself at 1:1, the same either way round', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 12)
    expect(contrast('#ffffff', '#000000')).toBeCloseTo(21, 12)
    expect(contrast('#476c9b', '#476c9b')).toBe(1)
  })

  it('agrees with the published figure for the lightest grey that passes as text on white, #767676 at 4.54:1', () => {
    expect(contrast('#767676', '#ffffff')).toBeCloseTo(4.54, 2)
    expect(contrast('#777777', '#ffffff')).toBeLessThan(4.5)
  })
})

describe('the colour tokens, every pair the brand book names (spec #9, seam 2)', () => {
  it.each(pairs)('%s on %s reaches %s:1', (foreground, ground, minimum) => {
    expect(contrast(hexOf(foreground), hexOf(ground))).toBeGreaterThanOrEqual(minimum)
  })

  it('refuses a pair that is not in tokens.json rather than passing it', () => {
    expect(() => hexOf('text-loud')).toThrow(/no colour token/)
  })
})
