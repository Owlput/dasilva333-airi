import fs from 'node:fs'
import path from 'node:path'

import { fileURLToPath } from 'node:url'

import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc'
import { describe, expect, it } from 'vitest'

import ProviderPickerGrid from './components/provider-picker-grid.vue'

import { ARCHETYPE_MODULE_PRESETS } from './stores/useOnboardingV3Draft'
import { ONBOARDING_V3_STEPS } from './types'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ROOT CAUSE:
//
// In commit ffc8ca48be, an optimization pass removed:
// `-import ProviderPickerGrid from '../../v2/components/provider-picker-grid.vue'`
// under the mistaken assumption that it was an obsolete/unused V2 reference.
//
// However, <ProviderPickerGrid> was actively used in the template of
// `step-consciousness.vue` under the "Custom API Key" tab. Because Vue's
// SFC compiler treats undeclared template tags as dynamic global components
// via `_resolveComponent("ProviderPickerGrid")`, it did not fail at build time.
// At runtime, the unresolved component produced `undefined`, silently rendering
// the entire "Choose an AI Brain Provider" picker grid as an empty comment node.
//
// FIXED BY:
// 1. Creating a native V3 component: `v3/components/provider-picker-grid.vue`.
// 2. Importing it explicitly in `step-consciousness.vue`.
// 3. Adding an automated static SFC template-binding audit across all V3 onboarding
//    steps to guarantee that every template component has a valid script binding
//    and cannot silently compile into `_resolveComponent`.

describe('onboarding V3 Component Integrity & Regression Protection', () => {
  it('exports ProviderPickerGrid as a valid Vue component object', () => {
    expect(ProviderPickerGrid).toBeDefined()
    expect(typeof ProviderPickerGrid).toBe('object')
  })

  it('reproduces Issue: step-consciousness.vue must explicitly bind ProviderPickerGrid and not emit _resolveComponent', () => {
    const filePath = path.join(__dirname, 'steps', 'step-consciousness.vue')
    const content = fs.readFileSync(filePath, 'utf-8')
    const parsed = parse(content)

    expect(parsed.descriptor.template).not.toBeNull()
    expect(parsed.descriptor.scriptSetup).not.toBeNull()

    const script = compileScript(parsed.descriptor, { id: 'test-consciousness' })
    expect(script.bindings).toHaveProperty('ProviderPickerGrid')

    const compiled = compileTemplate({
      source: parsed.descriptor.template!.content,
      id: 'test-consciousness',
      filename: filePath,
      compilerOptions: { bindingMetadata: script.bindings },
    })

    const unresolved = [...compiled.code.matchAll(/_resolveComponent\("([^"]+)"\)/g)].map(m => m[1])
    expect(unresolved).not.toContain('ProviderPickerGrid')
  })

  it('audits all Onboarding V3 Vue files to ensure zero unimported template components', () => {
    function getVueFiles(dir: string): string[] {
      const results: string[] = []
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          results.push(...getVueFiles(fullPath))
        }
        else if (entry.name.endsWith('.vue')) {
          results.push(fullPath)
        }
      }
      return results
    }

    const vueFiles = getVueFiles(__dirname)
    expect(vueFiles.length).toBeGreaterThanOrEqual(18)

    const ALLOWED_GLOBALS = new Set([
      'component',
      'RouterView',
      'RouterLink',
      'Transition',
      'Teleport',
      'KeepAlive',
      'Suspense',
      'i18n-t',
      'I18nT',
    ])

    const violations: { file: string, unresolved: string[] }[] = []

    for (const file of vueFiles) {
      const content = fs.readFileSync(file, 'utf-8')
      const parsed = parse(content)
      if (!parsed.descriptor.template)
        continue

      let bindings = {}
      if (parsed.descriptor.scriptSetup || parsed.descriptor.script) {
        try {
          const script = compileScript(parsed.descriptor, { id: `audit-${path.basename(file)}` })
          bindings = script.bindings || {}
        }
        catch (err: any) {
          throw new Error(`Failed to compile script for ${file}: ${err.message}`)
        }
      }

      const compiled = compileTemplate({
        source: parsed.descriptor.template.content,
        id: `audit-${path.basename(file)}`,
        filename: file,
        compilerOptions: { bindingMetadata: bindings },
      })

      const unresolved = [...compiled.code.matchAll(/_resolveComponent\("([^"]+)"\)/g)]
        .map(m => m[1])
        .filter(compName => !ALLOWED_GLOBALS.has(compName))

      if (unresolved.length > 0) {
        violations.push({
          file: path.relative(__dirname, file),
          unresolved,
        })
      }
    }

    expect(violations).toEqual([])
  })

  it('guarantees persona step is a core foundational step and is never omitted for quiet observer', () => {
    // 1. Static check: persona step must NOT be guarded by any moduleKey
    const personaStep = ONBOARDING_V3_STEPS.find(s => s.id === 'persona')
    expect(personaStep).toBeDefined()
    expect(personaStep?.moduleKey).toBeUndefined()

    // 2. Static source code check: onboarding-v3.vue and step-experience.vue must not filter out persona for quiet
    const orchestratorCode = fs.readFileSync(path.join(__dirname, 'onboarding-v3.vue'), 'utf-8')
    expect(orchestratorCode).not.toMatch(/step\.id\s*===\s*['"]persona['"]\s*&&\s*(?:[^\s,][^,\n]*)?['"]quiet['"]/)
    expect(orchestratorCode).not.toMatch(/['"]quiet['"]\s*&&\s*step\.id\s*===\s*['"]persona['"]/)

    const experienceCode = fs.readFileSync(path.join(__dirname, 'steps', 'step-experience.vue'), 'utf-8')
    expect(experienceCode).not.toMatch(/step\.id\s*===\s*['"]persona['"]\s*&&\s*(?:[^\s,][^,\n]*)?['"]quiet['"]/)
    expect(experienceCode).not.toMatch(/['"]quiet['"]\s*&&\s*step\.id\s*===\s*['"]persona['"]/)

    // 3. Simulated step filtering logic across all archetypes
    for (const [archetypeId, modules] of Object.entries(ARCHETYPE_MODULE_PRESETS)) {
      const isNoModel = archetypeId === 'quiet' || !modules?.emotions
      const activeSteps = ONBOARDING_V3_STEPS.filter((step) => {
        if (step.id === 'vessel')
          return !isNoModel
        if (!step.moduleKey)
          return true
        return Boolean(modules[step.moduleKey])
      })

      const hasPersona = activeSteps.some(s => s.id === 'persona')
      expect(hasPersona, `Archetype '${archetypeId}' must include 'persona' step`).toBe(true)
    }
  })
})
