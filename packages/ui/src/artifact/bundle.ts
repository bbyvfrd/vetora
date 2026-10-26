import { build, type Plugin, transform } from 'esbuild'

/**
 * The first line of the artifact's `components/bundle.js` (the artifact type's `format.md`): the global the bundle
 * assigns and the components the page lists, in the order it shows them. The catalogue is the artifact's: a sync keeps
 * the header of the bundle it replaces, and a new component is added to it by hand.
 */
export interface BundleHeader {
  format: 4
  namespace: string
  components: { name: string }[]
}

const headerPattern = /^\/\* @ds-bundle: (\{.*\}) \*\/$/

/** The header of a bundle the artifact holds, read so that the rebuilt bundle keeps the page's catalogue. */
export function readHeader(bundle: string): BundleHeader {
  const json = headerPattern.exec(bundle.split('\n', 1)[0] ?? '')?.[1]
  if (!json) throw new Error('the bundle has no /* @ds-bundle: … */ header on its first line')
  const header = JSON.parse(json) as Partial<BundleHeader>
  const readable =
    header.format === 4 &&
    typeof header.namespace === 'string' &&
    Array.isArray(header.components) &&
    header.components.every((component) => typeof component?.name === 'string')
  if (!readable)
    throw new Error(`the bundle's header is not one the page reads (format 4, a namespace, names): ${json}`)
  return header as BundleHeader
}

// The page loads React 18.3.1 and React DOM as classic scripts before the bundle, so the two resolve to the globals,
// and the automatic JSX runtime the sources compile to is shimmed over createElement (the artifact type's
// `from-code.md`). The sources import nothing else outside their own files.
const globals: Record<string, string> = {
  react: 'module.exports = window.React',
  'react-dom': 'module.exports = window.ReactDOM',
  'react/jsx-runtime': `const React = window.React
export const Fragment = React.Fragment
export function jsx(type, props, key) {
  return React.createElement(type, key === undefined ? props : Object.assign({}, props, { key }))
}
export const jsxs = jsx`,
}

const reactGlobals: Plugin = {
  name: 'react-globals',
  setup(builder) {
    const namespace = 'react-globals'
    builder.onResolve({ filter: /^[^./]/ }, ({ path, importer }) =>
      path in globals
        ? { path, namespace }
        : { errors: [{ text: `${importer} imports ${path}: the artifact's sources import only react and react-dom` }] },
    )
    builder.onLoad({ filter: /.*/, namespace }, ({ path }) => ({
      contents: globals[path],
      loader: 'js',
    }))
  },
}

/**
 * Builds the artifact's `components/bundle.js` from the sources at `entry` (`components/src/index.ts`): one classic
 * script, minified, that reads React from `window` and assigns every export to `window[header.namespace]`, with the
 * page's header on its first line. The artifact's page never builds the sources itself (checked on 2026-10-26, ticket
 * #15), so a sync up rebuilds this file with them.
 */
export async function buildBundle(entry: string, header: BundleHeader): Promise<string> {
  const { namespace } = header
  if (!/^[A-Za-z_$][\w$]*$/.test(namespace)) throw new Error(`the namespace ${namespace} is not a global's name`)
  // Bundled as a module first, whose metafile lists the exports (an iife's lists none), then wrapped as a script.
  const esm = await build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    metafile: true,
    format: 'esm',
    target: 'es2020',
    jsx: 'automatic',
    tsconfigRaw: {},
    define: { 'process.env.NODE_ENV': '"production"' },
    logLevel: 'silent',
    plugins: [reactGlobals],
  })
  const output = esm.outputFiles[0]?.text
  if (!output) throw new Error(`esbuild wrote nothing for ${entry}`)
  const exported = new Set(Object.values(esm.metafile.outputs).flatMap((file) => file.exports))
  const missing = header.components.map((c) => c.name).filter((name) => !exported.has(name))
  if (missing.length > 0)
    throw new Error(`the header lists components the sources do not export: ${missing.join(', ')}`)
  const script = await transform(output, {
    format: 'iife',
    globalName: '__bundle',
    minify: true,
    target: 'es2020',
    legalComments: 'none',
  })
  const code = script.code.trimEnd()
  const bundle = `/* @ds-bundle: ${JSON.stringify(header)} */
(function(){${code}
window.${namespace}=Object.assign(window.${namespace}||{},__bundle);})();
`
  // The page writes the bundle into an inline script element, which either string would end or escape.
  if (/<\/script|<!--/i.test(bundle)) throw new Error('the bundle holds </script or <!--')
  return bundle
}
