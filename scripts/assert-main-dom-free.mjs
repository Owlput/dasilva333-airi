#!/usr/bin/env node
/**
 * Assert that no renderer runtime module is reachable from the Electron main entry (§4.7 "Build assertion",
 * §4.9 criterion 5).
 *
 * Tree-shaking is a bundler behaviour, not a guarantee: a stray `import` of `@proj-airi/stage-ui`, a `.vue` file
 * or a scene package from `src/main` would be pulled into the main bundle and, worse, would make main depend on
 * the DOM. CI runs this script so the boundary is checked by something that is not the bundler.
 *
 * Two checks, both static:
 *
 *   1. **main's import graph.** Start at `apps/stage-tamagotchi/src/main/index.ts`, follow every non-type-only
 *      static import, re-export and dynamic `import()` using TypeScript's own module resolution (so aliases and
 *      package exports behave exactly as `tsc` does), and fail on the first renderer runtime module reached.
 *      Type-only imports are skipped: they are erased and have no runtime edge.
 *   2. **manager modules.** A driver's `manager` runs in main, so it must not import a renderer package, a Vue
 *      component, Vue, Three or Pixi either.
 *
 * Run with `node scripts/assert-main-dom-free.mjs` (no build, no Electron).
 */
import process from 'node:process'

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'

import ts from 'typescript'

const repositoryRoot = resolve(import.meta.dirname, '..')
const mainEntry = resolve(repositoryRoot, 'apps/stage-tamagotchi/src/main/index.ts')
const mainTsconfig = resolve(repositoryRoot, 'apps/stage-tamagotchi/tsconfig.node.json')

/** Packages that only make sense with a DOM, a GPU context or a Vue runtime. */
const FORBIDDEN_PACKAGES = [
  'vue',
  'vue-router',
  'pinia',
  'three',
  '@pixiv/three-vrm',
  'pixi.js',
  '@pixi/',
  '@tresjs/',
  'live2dcubismframework',
  '@proj-airi/stage-ui',
  '@proj-airi/stage-ui-three',
  '@proj-airi/stage-ui-live2d',
  '@proj-airi/stage-ui-mmd',
  '@proj-airi/stage-ui-spine',
  '@proj-airi/stage-pages',
  '@proj-airi/stage-layouts',
]

/** A path inside the repository that is renderer-only regardless of how it was named. */
const FORBIDDEN_PATHS = [
  `${sep}packages${sep}stage-ui${sep}`,
  `${sep}packages${sep}stage-ui-three${sep}`,
  `${sep}packages${sep}stage-ui-live2d${sep}`,
  `${sep}packages${sep}stage-ui-mmd${sep}`,
  `${sep}packages${sep}stage-ui-spine${sep}`,
  `${sep}packages${sep}stage-pages${sep}`,
  `${sep}packages${sep}stage-layouts${sep}`,
]

function isForbiddenSpecifier(specifier) {
  return FORBIDDEN_PACKAGES.some(pkg => specifier === pkg
    || specifier.startsWith(`${pkg}/`)
    // `@pixi/` and `@tresjs/` are prefixes rather than names.
    || (pkg.endsWith('/') && specifier.startsWith(pkg)))
}

function isForbiddenFile(fileName) {
  if (fileName.endsWith('.vue'))
    return 'a Vue single-file component'
  if (FORBIDDEN_PATHS.some(fragment => fileName.includes(fragment)))
    return 'a renderer package'
  return undefined
}

function loadCompilerOptions(configPath) {
  const config = ts.readConfigFile(configPath, ts.sys.readFile)
  if (config.error) {
    console.error(`Could not read ${relative(repositoryRoot, configPath)}: ${ts.flattenDiagnosticMessageText(config.error.messageText, '\n')}`)
    process.exit(2)
  }

  const parsed = ts.parseJsonConfigFileContent(
    config.config,
    ts.sys,
    dirname(configPath),
    // `composite` would want every listed file; this walk starts at the entry instead.
    { composite: false, noEmit: true },
    configPath,
  )

  if (parsed.errors.length > 0) {
    for (const error of parsed.errors)
      console.error(ts.flattenDiagnosticMessageText(error.messageText, '\n'))
    process.exit(2)
  }

  return parsed.options
}

/** Every module edge in one file, minus type-only ones. */
function importEdgesOf(sourceFile) {
  const edges = []

  const visit = (node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause
      let typeOnly = false
      if (clause) {
        if (clause.isTypeOnly) {
          // `import type {...} from '…'` is erased entirely.
          typeOnly = true
        }
        else if (!clause.name && clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
          // `import { type A, type B } from '…'` is erased too, but `import A, { type B } from '…'` is not.
          typeOnly = clause.namedBindings.elements.length > 0
            && clause.namedBindings.elements.every(element => element.isTypeOnly)
        }
      }
      if (!typeOnly)
        edges.push({ specifier: node.moduleSpecifier.text, line: lineOf(sourceFile, node) })
    }
    else if (ts.isExportDeclaration(node) && !node.isTypeOnly && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      edges.push({ specifier: node.moduleSpecifier.text, line: lineOf(sourceFile, node) })
    }
    else if (ts.isCallExpression(node)
      && node.expression.kind === ts.SyntaxKind.ImportKeyword
      && node.arguments.length === 1
      && ts.isStringLiteral(node.arguments[0])) {
      edges.push({ specifier: node.arguments[0].text, line: lineOf(sourceFile, node), dynamic: true })
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return edges
}

function lineOf(sourceFile, node) {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
}

/**
 * Whether a resolved file is worth walking.
 *
 * Declarations are skipped because they describe types, not runtime edges — a `.d.ts` import of `vue` inside a
 * dependency's types is erased and would be a false alarm. `node_modules` is skipped for the same reason at one
 * remove: a third-party package's internal structure is not this repository's boundary, and a renderer package
 * imported from main is already caught by name at the import site.
 */
function shouldWalk(fileName) {
  if (/\.d\.[cm]?ts$/.test(fileName))
    return false
  if (fileName.includes(`${sep}node_modules${sep}`))
    return false
  return true
}

function walkMainGraph(options) {
  const visited = new Set()
  const queue = [mainEntry]
  const violations = []
  const unresolved = []

  while (queue.length > 0) {
    const current = queue.pop()
    if (visited.has(current))
      continue
    visited.add(current)

    const fileViolation = isForbiddenFile(current)
    if (fileViolation)
      violations.push({ file: current, reason: `is ${fileViolation}` })

    const text = ts.sys.readFile(current)
    if (text === undefined)
      continue

    const sourceFile = ts.createSourceFile(current, text, ts.ScriptTarget.Latest, true)
    for (const edge of importEdgesOf(sourceFile)) {
      if (isForbiddenSpecifier(edge.specifier)) {
        violations.push({
          file: current,
          line: edge.line,
          reason: `imports \`${edge.specifier}\``,
        })
        continue
      }

      const resolved = ts
        .resolveModuleName(edge.specifier, current, options, ts.sys)
        .resolvedModule
      if (!resolved) {
        // Node builtins and bundler query suffixes (`?asset`) are not modules to walk, and a main-side alias
        // (`@proj-airi/i18n-bundle`) is a build-configuration fact rather than a renderer leak. They are counted
        // and listed so a missing alias cannot quietly hide an imported module.
        if (!edge.specifier.startsWith('node:') && !edge.specifier.includes('?'))
          unresolved.push({ file: current, line: edge.line, specifier: edge.specifier })
        continue
      }

      const next = resolve(resolved.resolvedFileName)
      if (shouldWalk(next))
        queue.push(next)
    }
  }

  return { visited, violations, unresolved }
}

/** Driver manager modules: the DOM-free half every driver package ships (§4.7). */
function findManagerModules() {
  const found = []
  const packagesRoot = join(repositoryRoot, 'packages')

  const walk = (directory) => {
    let entries
    try {
      entries = readdirSync(directory)
    }
    catch {
      return
    }

    for (const entry of entries) {
      const full = join(directory, entry)
      if (entry === 'node_modules' || entry === 'dist' || entry === '.git')
        continue
      const stats = statSync(full)
      if (stats.isDirectory()) {
        walk(full)
        continue
      }
      if (!full.endsWith('.ts') || full.endsWith('.d.ts'))
        continue
      // `src/driver/manager.ts` is the convention for a driver package's main-side manager. No driver package
      // exists yet (Phase 3+), so the only member in Phase 1 is the stub driver's DOM-free exemplar, now in the SDK.
      if (full.includes(`${sep}src${sep}driver${sep}manager.ts`) || full === join(repositoryRoot, 'packages', 'stage-renderer-sdk', 'src', 'host', 'testing', 'stub-driver.ts')) {
        found.push(full)
      }
    }
  }

  walk(packagesRoot)
  return found
}

function checkManagerModules() {
  const violations = []
  const files = findManagerModules()

  for (const file of files) {
    const text = readFileSync(file, 'utf8')
    const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)

    for (const edge of importEdgesOf(sourceFile)) {
      if (isForbiddenSpecifier(edge.specifier)) {
        violations.push({
          file,
          line: edge.line,
          reason: `imports \`${edge.specifier}\`, which only exists in a renderer`,
        })
      }
    }
  }

  return { violations, checked: files.length }
}

const options = loadCompilerOptions(mainTsconfig)
const graph = walkMainGraph(options)
const managerCheck = checkManagerModules()

const allViolations = [...graph.violations, ...managerCheck.violations]

if (graph.unresolved.length > 0) {
  console.info(`[main-dom-free] note: ${graph.unresolved.length} main-side alias/builtin import(s) were not followed:`)
  for (const item of graph.unresolved.slice(0, 10))
    console.info(`  ${relative(repositoryRoot, item.file)}:${item.line} → ${item.specifier}`)
}

if (allViolations.length > 0) {
  console.error(`[main-dom-free] ${allViolations.length} forbidden renderer dependency reachable from main:`)
  for (const violation of allViolations)
    console.error(`  ${relative(repositoryRoot, violation.file)}${violation.line ? `:${violation.line}` : ''} ${violation.reason}`)
  process.exit(1)
}

console.info(`[main-dom-free] OK — ${graph.visited.size} module(s) reachable from the main entry, ${managerCheck.checked} manager/convention module(s) inspected, no renderer runtime module among them.`)
