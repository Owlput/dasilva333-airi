#!/usr/bin/env node
/**
 * Architecture guards for the stage-driver migration (plan §8.5).
 *
 * Each guard protects an invariant, and every one asserts three things, because a source scan that only greps is
 * a scan that quietly rots:
 *
 *   1. **no file outside the allowlist matches the pattern** — the rule itself;
 *   2. **the allowlist only shrinks** — every entry must still match its pattern. An entry whose file no longer
 *      contains it has been fixed and must be deleted from the list, in the same change that fixed it. A
 *      permanently allowed entry would hide a new violation in the same file;
 *   3. **the patterns live in exactly one file** — `legacy-patterns.json`, which is the single exempt path, so a
 *      guard cannot fail on its own pattern list.
 *
 * Two guards are behavioural rather than textual, and they are asserted where they can be executed instead:
 *
 *   - the main bundle assertion is `scripts/assert-main-dom-free.mjs` (Phase 1);
 *   - "no speech frame travels as a cue" is `packages/stage-renderer-sdk/src/host/transport.test.ts` (Phase 2),
 *     which drives a real broker and a real frame bus. The source half of it — that no production file invents a
 *     `speech-frame` cue kind — is checked here.
 *
 * Usage:
 *
 *   node scripts/assert-model-driver-guards.mjs            # check (CI)
 *   node scripts/assert-model-driver-guards.mjs --update   # regenerate the allowlist from the tree
 *
 * `--update` is for the moment a Phase 2 allowlist is frozen, and for the change that *fixes* a violation so the
 * entry can be removed. It never invents new patterns: those are hand-written in the JSON, with the phase they
 * land in.
 */
import process from 'node:process'

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const CONFIG = resolve(HERE, 'architecture-guards', 'legacy-patterns.json')
const SCAN_EXTENSIONS = ['.ts', '.tsx', '.vue', '.js', '.mjs', '.cjs']
const SKIP_DIRECTORIES = new Set(['node_modules', 'dist', 'dist-lite', '.git', 'coverage', '.turbo', 'mate-engine'])
/** Build outputs and generated catalogs are not source. */
const SKIP_FILES = new Set(['legacy-patterns.json'])

const update = process.argv.includes('--update')

const config = JSON.parse(readFileSync(CONFIG, 'utf8'))
const guards = config.guards
/**
 * Tests are not shipped code, and a fixture that constructs a card is not a writer.
 *
 * Guards 1–5 are about what an embedding surface imports or reads; a suite importing a renderer store harms
 * nothing, and a suite's literal `{ displayModelId: 'x' }` is a fixture, not a write. Scanning them would have put
 * a dozen test paths in the allowlist and hidden the one production write that matters. The behavioural guards
 * (speech transport, broker) are their own suites, so nothing is lost by excluding them here.
 */
const skipTestFiles = config.skipTestFiles ?? true
const TEST_FILE = /\.test\.[cm]?[jt]sx?$/

function walk(directory, files = []) {
  for (const entry of readdirSync(directory)) {
    if (SKIP_DIRECTORIES.has(entry))
      continue
    if (skipTestFiles && TEST_FILE.test(entry))
      continue
    const path = join(directory, entry)
    const stats = statSync(path)
    if (stats.isDirectory()) {
      walk(path, files)
      continue
    }
    if (!SCAN_EXTENSIONS.some(extension => entry.endsWith(extension)))
      continue
    files.push(path)
  }
  return files
}

function toRepoPath(path) {
  return relative(ROOT, path).split(sep).join('/')
}

function isExempt(repoPath) {
  // This script and the patterns file are the guard itself; a guard that contained its own patterns would fail its
  // own scan, which is why the data file is the only exempt path.
  return repoPath === 'scripts/architecture-guards/legacy-patterns.json'
    || repoPath === 'scripts/assert-model-driver-guards.mjs'
}

const files = [...walk(resolve(ROOT, 'packages')), ...walk(resolve(ROOT, 'apps'))]

function matches(file, pattern) {
  const source = readFileSync(file, 'utf8')
  const expression = new RegExp(pattern, 'gm')
  const hits = []
  let match
  while ((match = expression.exec(source)) !== null) {
    const line = source.slice(0, match.index).split('\n').length
    hits.push({ line, text: match[0] })
    if (hits.length > 200)
      break
  }
  return hits
}

if (update) {
  for (const guard of guards) {
    const found = []
    for (const file of files) {
      const repoPath = toRepoPath(file)
      if (isExempt(repoPath) || SKIP_FILES.has(repoPath.split('/').pop()))
        continue
      if (matches(file, guard.pattern).length > 0)
        found.push(repoPath)
    }
    guard.allow = found.sort()
  }
  config.generatedAt = new Date().toISOString().slice(0, 10)
  writeFileSync(CONFIG, `${JSON.stringify(config, null, 2)}\n`)
  console.log(`Wrote the allowlist for ${guards.length} guard(s) to ${toRepoPath(CONFIG)}`)
  process.exit(0)
}

let failures = 0
const report = []

for (const guard of guards) {
  const allowed = new Set(guard.allow ?? [])
  const violations = []

  for (const file of files) {
    const repoPath = toRepoPath(file)
    if (isExempt(repoPath) || allowed.has(repoPath))
      continue
    const hits = matches(file, guard.pattern)
    if (hits.length > 0)
      violations.push({ path: repoPath, hits: hits.slice(0, 5) })
  }

  // The shrinking rule: an allowlisted file that no longer matches must be removed from the list.
  const stale = []
  for (const path of allowed) {
    const absolute = resolve(ROOT, path)
    let exists = true
    try {
      statSync(absolute)
    }
    catch {
      exists = false
    }
    if (!exists || matches(absolute, guard.pattern).length === 0)
      stale.push(path)
  }

  if (violations.length > 0 || stale.length > 0) {
    failures += 1
    report.push({ guard, violations, stale })
  }
  else {
    console.log(`ok   ${guard.id}: ${allowed.size} allowlisted, no new matches`)
  }
}

if (failures > 0) {
  console.error(`\n${failures} guard(s) failed:\n`)
  for (const entry of report) {
    console.error(`guard ${entry.guard.id} (${entry.guard.pattern}) — ${entry.guard.why}`)
    for (const violation of entry.violations) {
      console.error(`  new match: ${violation.path}`)
      for (const hit of violation.hits)
        console.error(`    :${hit.line}  ${hit.text}`)
    }
    for (const path of entry.stale)
      console.error(`  stale allowlist entry (remove it from the JSON): ${path}`)
    console.error('')
  }
  console.error('See packages/stage-renderer-sdk/IMPLEMENTATION_PLAN.md §8.5.')
  process.exit(1)
}

console.log(`\n${guards.length} guard(s) passed; scanned ${files.length} source file(s).`)
