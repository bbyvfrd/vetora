import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { compileTokens } from './compile.js'
import tokens from './tokens.json' with { type: 'json' }

// `pnpm --filter @vetora/ui tokens` builds the package and runs this from dist/, rewriting styles/tokens.css. The
// output is committed and compile.test.ts fails when it is stale, so a token change is: change the artifact, copy
// its tokens.json over src/tokens/tokens.json, run the script, commit both.
const target = new URL('../../styles/tokens.css', import.meta.url)
writeFileSync(target, compileTokens(tokens))
console.log(`wrote ${fileURLToPath(target)}`)
