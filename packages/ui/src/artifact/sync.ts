import { copyFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { buildBundle, readHeader } from './bundle.js'

/** The icon set's path data: design data, the artifact's (ADR 0005), so it comes down with the set and never goes up. */
const iconData = 'icons.ts'

export interface SyncResult {
  /** The files of `src/` copied into the saved copy's `project/components/src/`, by name. */
  copied: string[]
  /** Files the saved copy's `project/components/src/` holds that the repo no longer has, to publish as removed. */
  stale: string[]
}

/**
 * A sync up into `folder`, the saved copy of the artifact an Artifact tool read made: copies the component sources, the
 * helpers beside them and the index from `sources` (the package's `src/`; not the tests, the icon data or the repo's
 * own tools in the folders) over the saved ones as they are, then rebuilds `project/components/bundle.js` from what
 * the saved copy's `components/src/` holds, under the header of the bundle it replaces. The saved bundle and the
 * artifact's icon data are checked before anything is written.
 */
export async function syncUp(folder: string, sources: string): Promise<SyncResult> {
  const components = resolve(folder, 'project/components')
  const target = join(components, 'src')
  const bundlePath = join(components, 'bundle.js')
  for (const needed of [bundlePath, join(target, iconData)]) {
    if (!existsSync(needed)) throw new Error(`${needed} is missing: read it from the artifact into ${folder} first`)
  }
  const header = readHeader(readFileSync(bundlePath, 'utf8'))
  const copied = readdirSync(sources).filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) && f !== iconData)
  for (const file of copied) copyFileSync(join(sources, file), join(target, file))
  writeFileSync(bundlePath, await buildBundle(join(target, 'index.ts'), header))
  const stale = readdirSync(target).filter((f) => f !== iconData && !copied.includes(f))
  return { copied, stale }
}
