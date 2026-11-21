// @ts-check
/**
 * `vue-tsc` that also works under Bun.
 *
 * vue-tsc (via @volar/typescript `runTsc`) patches TypeScript's compiler by
 * overriding `fs.readFileSync` while it `require`s `typescript/lib/tsc.js`.
 * Bun's module loader does not read modules through `fs.readFileSync`, so
 * under Bun (this project has no Node) the patch silently never applies: tsc
 * runs unpatched, skips every `.vue` file and reports success. This wrapper
 * applies the same transform explicitly, writes the patched compiler next to
 * the original (so it still finds its `lib.*.d.ts` files) and runs it.
 *
 * Usage: `bun scripts/vue-tsc.cjs --noEmit` (the `typecheck` / `build` scripts).
 */
const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const vue = require('@vue/language-core')

const runTscPath = require.resolve('@volar/typescript/lib/quickstart/runTsc')
const runTsc = require(runTscPath)
const proxyApiPath = require.resolve('@volar/typescript/lib/node/proxyCreateProgram')
const tscDir = path.dirname(require.resolve('typescript/lib/tsc'))
const source = fs.readFileSync(path.join(tscDir, '_tsc.js'), 'utf8')

const configPath = path.resolve(__dirname, '..', 'tsconfig.json').replace(/\\/g, '/')
const vueOptions = vue.createParsedCommandLine(ts, ts.sys, configPath).vueOptions
const extensions = vue.getAllExtensions(vueOptions)

runTsc.getLanguagePlugins = (tsInstance, options) => [
  vue.createVueLanguagePlugin(tsInstance, options.options, vueOptions, (id) => id),
]
const patched = runTsc.transformTscContent(source, proxyApiPath, extensions, [], runTscPath)
const patchedPath = path.join(tscDir, '_tsc.vue-bun.js')
if (!fs.existsSync(patchedPath) || fs.readFileSync(patchedPath, 'utf8') !== patched) fs.writeFileSync(patchedPath, patched)
require(patchedPath)
