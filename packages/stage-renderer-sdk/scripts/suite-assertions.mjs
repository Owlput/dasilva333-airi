/**
 * The subset of vitest's API this package's suites use, so files written for `vitest` execute unchanged
 * under `scripts/run-suites.mjs`.
 *
 * Not a test framework: there is no transform, no mocking, no snapshotting, no reporters, and no
 * isolation between suites beyond what each file does itself. It exists only for environments where the
 * real runner cannot start, and `pnpm -F @proj-airi/stage-renderer-sdk test` remains authoritative.
 *
 * `toEqual` is deliberately not `assert.deepStrictEqual`: the suites compare against asymmetric matchers
 * (`expect.objectContaining`) nested inside plain objects and arrays, which a strict deep comparison
 * cannot express. Values without matchers, including `Blob`, `Map` and `Date`, still go through
 * `isDeepStrictEqual`, so prototype and identity semantics are unchanged from vitest's `toEqual`.
 */
import process from 'node:process'

import { isDeepStrictEqual } from 'node:util'

/** Print each test before it runs, so a suite that hangs names itself instead of the run ending silently. */
const verbose = Boolean(process.env.SDK_SUITE_VERBOSE)

const root = { name: '', parent: null, children: [], tests: [], beforeEach: [], afterEach: [] }
let node = root

export function describe(name, body) {
  const child = { name, parent: node, children: [], tests: [], beforeEach: [], afterEach: [] }
  node.children.push(child)
  const previous = node
  node = child
  try {
    body()
  }
  finally {
    node = previous
  }
}

export function it(name, body) {
  node.tests.push({ name, body })
}

export const test = it

/**
 * Hooks, scoped to the suite that declares them (and its descendants), as vitest scopes them.
 *
 * Needed by the app's IPC contract suites, which open a transport per test and must close it even when an assertion
 * fails — an undisposed `BroadcastChannel` keeps the process alive, so a leaked pair hangs the run instead of failing
 * it. Registration is collected per suite; `runAll` applies ancestors outermost-first and unwinds innermost-first.
 */
export function beforeEach(body) {
  node.beforeEach.push(body)
}

export function afterEach(body) {
  node.afterEach.push(body)
}

export class AssertionError extends Error {}

function fail(message) {
  throw new AssertionError(message)
}

function label(value) {
  if (typeof value === 'function')
    return `[Function ${value.name || 'anonymous'}]`
  if (value instanceof Map)
    return `Map(${value.size})`
  try {
    return JSON.stringify(value)
  }
  catch {
    return String(value)
  }
}

const ASYMMETRIC = Symbol.for('suite-assertions.asymmetric')

export function objectContaining(expected) {
  return { [ASYMMETRIC]: 'objectContaining', value: expected }
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object')
    return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function deepEqual(actual, expected) {
  if (expected && typeof expected === 'object' && expected[ASYMMETRIC]) {
    return expected[ASYMMETRIC] === 'objectContaining'
      ? matchObject(actual, expected.value)
      : false
  }

  if (isDeepStrictEqual(actual, expected))
    return true

  if (Array.isArray(actual) && Array.isArray(expected))
    return actual.length === expected.length && expected.every((value, index) => deepEqual(actual[index], value))

  if (isPlainObject(actual) && isPlainObject(expected)) {
    const actualKeys = Object.keys(actual)
    const expectedKeys = Object.keys(expected)
    return actualKeys.length === expectedKeys.length
      && expectedKeys.every(key => key in actual && deepEqual(actual[key], expected[key]))
  }

  return false
}

function matchObject(actual, expected) {
  if (expected === null || typeof expected !== 'object')
    return deepEqual(actual, expected)
  if (actual === null || typeof actual !== 'object')
    return false
  return Object.entries(expected).every(([key, value]) => matchObject(actual[key], value))
}

export function expect(actual, hint) {
  const prefix = hint ? `${hint}: ` : ''

  const check = (condition, message) => {
    if (!condition)
      fail(`${prefix}${message}`)
  }

  const matchers = {
    toBe: expected => check(Object.is(actual, expected), `expected ${label(actual)} to be ${label(expected)}`),
    toEqual: expected => check(deepEqual(actual, expected), `expected ${label(actual)} to equal ${label(expected)}`),
    toStrictEqual: expected => check(deepEqual(actual, expected), `expected ${label(actual)} to strictly equal ${label(expected)}`),
    toMatchObject: expected => check(matchObject(actual, expected), `expected ${label(actual)} to match ${label(expected)}`),
    toHaveLength: length => check(actual != null && actual.length === length, `expected length ${actual?.length} to be ${length}`),
    toContain: (needle) => {
      const found = typeof actual === 'string'
        ? actual.includes(needle)
        : Array.isArray(actual) && actual.some(item => deepEqual(item, needle))
      check(found, `expected ${label(actual)} to contain ${label(needle)}`)
    },
    toContainEqual: (needle) => {
      const found = Array.isArray(actual) && actual.some(item => deepEqual(item, needle))
      check(found, `expected ${label(actual)} to contain ${label(needle)}`)
    },
    toMatch: (pattern) => {
      check(typeof actual === 'string', `expected a string, got ${label(actual)}`)
      const matched = pattern instanceof RegExp ? pattern.test(actual) : actual.includes(pattern)
      check(matched, `expected ${label(actual)} to match ${pattern}`)
    },
    toBeDefined: () => check(actual !== undefined, 'expected a value, got undefined'),
    toBeUndefined: () => check(actual === undefined, `expected undefined, got ${label(actual)}`),
    toBeNull: () => check(actual === null, `expected null, got ${label(actual)}`),
    toBeTruthy: () => check(Boolean(actual), `expected a truthy value, got ${label(actual)}`),
    toBeFalsy: () => check(!actual, `expected a falsy value, got ${label(actual)}`),
    toBeGreaterThan: value => check(actual > value, `expected ${label(actual)} to be greater than ${label(value)}`),
    toBeGreaterThanOrEqual: value => check(actual >= value, `expected ${label(actual)} to be >= ${label(value)}`),
    toBeLessThan: value => check(actual < value, `expected ${label(actual)} to be less than ${label(value)}`),
    toBeLessThanOrEqual: value => check(actual <= value, `expected ${label(actual)} to be <= ${label(value)}`),
    toBeInstanceOf: constructor => check(actual instanceof constructor, `expected ${label(actual)} to be a ${constructor.name}`),
    toHaveProperty: (path) => {
      const keys = Array.isArray(path) ? path : String(path).split('.')
      let cursor = actual
      for (const key of keys) {
        if (cursor === null || cursor === undefined || !(key in cursor))
          check(false, `expected ${label(actual)} to have property ${keys.join('.')}`)
        cursor = cursor[key]
      }
    },
    toThrow: (pattern) => {
      check(typeof actual === 'function', 'expected a function to throw')
      try {
        actual()
      }
      catch (error) {
        if (pattern instanceof RegExp)
          check(pattern.test(error.message), `expected thrown message ${label(error.message)} to match ${pattern}`)
        else if (typeof pattern === 'string')
          check(error.message.includes(pattern), `expected thrown message ${label(error.message)} to include ${label(pattern)}`)
        return
      }
      check(false, 'expected the function to throw')
    },
  }

  const negated = {}
  for (const [name, matcher] of Object.entries(matchers)) {
    negated[name] = (...args) => {
      try {
        matcher(...args)
      }
      catch {
        return
      }
      fail(`${prefix}expected ${label(actual)} not to satisfy \`.${name}\``)
    }
  }

  return { ...matchers, not: negated }
}

expect.objectContaining = objectContaining

export const results = { passed: 0, failed: [] }

/** Run every registered suite in declaration order and collect what failed. */
export async function runAll() {
  /** Hooks from the root down to `suite`, so a nested suite inherits what its parent declared. */
  const hooksOf = (suite, key) => {
    const chain = []
    for (let cursor = suite; cursor; cursor = cursor.parent)
      chain.unshift(cursor)
    return chain.flatMap(entry => entry[key])
  }

  const walk = async (suite, path) => {
    const title = path.concat(suite.name ? [suite.name] : []).join(' > ')
    for (const test of suite.tests) {
      if (verbose)
        console.info(`  ${title} > ${test.name}`)
      try {
        for (const hook of hooksOf(suite, 'beforeEach'))
          await hook()
        await test.body()
        results.passed += 1
      }
      catch (error) {
        results.failed.push({ title: `${title} > ${test.name}`, error })
      }
      finally {
        // Innermost first, so teardown can rely on what its parent set up. A hook that throws is reported as a
        // failure of this test rather than aborting the run.
        for (const hook of hooksOf(suite, 'afterEach').reverse()) {
          try {
            await hook()
          }
          catch (error) {
            results.failed.push({ title: `${title} > ${test.name} > afterEach`, error })
          }
        }
      }
    }
    for (const child of suite.children)
      await walk(child, path.concat(suite.name ? [suite.name] : []))
  }

  await walk(root, [])
  return results
}
