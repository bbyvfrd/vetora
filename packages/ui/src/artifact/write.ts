import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { syncUp } from './sync.js'

// `pnpm --filter @vetora/ui artifact <folder>` builds the package and runs this from dist/. <folder> is the saved copy
// of the artifact the Artifact tool's read made, holding at least project/components/bundle.js (for its header) and
// project/components/src/icons.ts (the icon data, the artifact's). It syncs the sources into it, rebuilds bundle.js,
// and prints the Artifact tool's `files` to publish (packages/ui/README.md, "Publishing changed sources up to the
// artifact").
const folder = process.argv[2]
if (!folder) throw new Error('usage: pnpm --filter @vetora/ui artifact <folder holding the saved project/>')
const { copied, stale } = await syncUp(folder, fileURLToPath(new URL('../../src/', import.meta.url)))

// The Artifact tool serves no .ts or .tsx by extension, so the sources go as text/plain, as the artifact lists them.
const source = (file: string) => `project/components/src/${file}`
const files = {
  'project/components/bundle.js': 'project/components/bundle.js',
  ...Object.fromEntries(copied.map((f) => [source(f), { from: source(f), contentType: 'text/plain' }])),
}
console.log(`wrote ${copied.length} sources and bundle.js; publish with root ${resolve(folder)} and these files:`)
console.log(JSON.stringify(files))
if (stale.length > 0) console.log(`not in the repo any more (publish each as null to remove): ${stale.join(', ')}`)
