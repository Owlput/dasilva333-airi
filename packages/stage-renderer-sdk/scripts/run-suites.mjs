#!/usr/bin/env node
/**
 * Execute this package's suites without Vite, esbuild or a child process.
 *
 * `pnpm -F @proj-airi/stage-renderer-sdk test` is the authoritative command and the one CI runs. This
 * script exists because that command cannot start in a spawn-restricted sandbox: Vite bundles
 * `vitest.config.ts` with esbuild, esbuild starts its service binary through `child_process` with piped
 * stdio, and the sandbox refuses it — before a single test file is loaded, so no `--pool` setting helps.
 *
 * It is not a test framework and not a replacement. It proves the suites' assertions, and nothing about
 * vitest's transform pipeline, reporters or coverage. A suite that starts needing `vi.fn`, `beforeEach`,
 * snapshots or module mocks cannot run here, and that is the intended failure: extend
 * `suite-assertions.mjs` deliberately, or fix the environment.
 *
 * Run from anywhere (Node ≥ 22.15 for `module.registerHooks`):
 *
 *   node --experimental-transform-types --no-warnings scripts/run-suites.mjs
 *   node --experimental-transform-types --no-warnings scripts/run-suites.mjs <suite files…>
 *
 * or through the package script: `pnpm -F @proj-airi/stage-renderer-sdk test:fallback`.
 *
 * With no arguments it discovers every `*.test.ts` under `src/`, so a new suite needs no registration
 * here; a new entry point needs one line in `FIXED`.
 */
import process from 'node:process'

import { existsSync, readdirSync, statSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { runAll } from './suite-assertions.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const PACKAGE_ROOT = resolve(HERE, '..')
const SOURCE = resolve(PACKAGE_ROOT, 'src')

const FIXED = new Map([
  // A suite imports `describe`/`it`/`expect` from `vitest`; the same specifier resolves to the subset
  // below, which is why the suite files need no edit to run here.
  ['vitest', resolve(HERE, 'suite-assertions.mjs')],
  ['@proj-airi/stage-renderer-sdk', resolve(SOURCE, 'index.ts')],
  ['@proj-airi/stage-renderer-sdk/host', resolve(SOURCE, 'host/index.ts')],
  ['@proj-airi/stage-renderer-sdk/testing', resolve(SOURCE, 'host/testing/index.ts')],
])

registerHooks({
  resolve(specifier, context, nextResolve) {
    const fixed = FIXED.get(specifier)
    if (fixed)
      return { url: pathToFileURL(fixed).href, shortCircuit: true }

    // The package's own imports are extensionless (`../../contract`, `./harness`), which Node does not
    // resolve for TypeScript sources. `base` itself may be a directory, so the file candidates come
    // first and only a real file is returned — otherwise Node reads the directory and fails with EISDIR.
    if (specifier.startsWith('.') && context.parentURL) {
      const base = fileURLToPath(new URL(specifier, context.parentURL))
      for (const candidate of [`${base}.ts`, resolve(base, 'index.ts'), base]) {
        if (!existsSync(candidate) || !statSync(candidate).isFile())
          continue
        return { url: pathToFileURL(candidate).href, shortCircuit: true }
      }
    }

    return nextResolve(specifier, context)
  },
})

function discover(directory) {
  const found = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules')
      continue
    const full = resolve(directory, entry.name)
    if (entry.isDirectory())
      found.push(...discover(full))
    else if (entry.name.endsWith('.test.ts'))
      found.push(full)
  }
  return found
}

const arguments_ = process.argv.slice(2)
const suites = arguments_.length > 0 ? arguments_.map(file => resolve(file)) : discover(SOURCE).sort()

if (suites.length === 0) {
  console.error(`No *.test.ts found under ${SOURCE}`)
  process.exitCode = 1
}
else {
  for (const suite of suites)
    await import(pathToFileURL(suite).href)

  const report = await runAll()

  for (const failure of report.failed) {
    console.error(`\nFAILED ${failure.title}`)
    console.error(failure.error?.stack ?? String(failure.error))
  }

  console.info(`\n${suites.length} suites: ${report.passed} passed, ${report.failed.length} failed`)
  process.exitCode = report.failed.length > 0 ? 1 : 0
}
