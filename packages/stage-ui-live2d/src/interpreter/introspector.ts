/**
 * introspector.ts - Live2D Capability & Gimmick Introspection Engine
 * Parses raw Live2D manifests and captured DSL motion groups into a strongly-typed,
 * normalized capability representation for the Gimmick Deck.
 */

import type { DslMotionGroup } from '@proj-airi/live2d-runtime'

export interface GimmickSwitch {
  name: string
  code?: string
  type?: number
  currentValue: number
}

export interface GimmickCostume {
  file: string
  label?: string
  slotIndex?: number
}

export interface GimmickPartController {
  name: string
  ids: string[]
  value: number
  keyValues?: number[]
  min: number
  max: number
  step: number
}

export interface GimmickChoiceOption {
  text: string
  nextMtn?: string
}

export interface GimmickChoiceTree {
  parentGroup?: string
  text?: string
  choices: GimmickChoiceOption[]
}

export interface GimmickReaction {
  group: string
  index?: number
  text: string
  sound?: string
  expression?: string
  nextMtn?: string
}

export interface GimmickIntimacy {
  hasIntimacy: boolean
  raw: number
  display: number
}

export interface GimmickHitArea {
  name: string
  id?: string
  motion?: string
  enabled: boolean
}

export interface Live2dCapabilities {
  hasDsl: boolean
  costumes: GimmickCostume[]
  switches: GimmickSwitch[]
  parts: GimmickPartController[]
  choices: GimmickChoiceTree[]
  reactions: GimmickReaction[]
  hitAreas: GimmickHitArea[]
  commands: string[]
  intimacy: GimmickIntimacy
}

const CHANGE_COS_RE = /change_cos\s+([^\s;'")]+)/gi

/**
 * Pure functional introspector that scans captured DSL groups and raw manifest settings.
 */
export function introspectCapabilities(
  groups: readonly DslMotionGroup[] = [],
  rawSettings?: Record<string, any>,
  currentVarSnapshot: Record<string, number> = {},
  intimacyRaw = 0,
): Live2dCapabilities {
  const costumesSet = new Set<string>()
  const switchesMap = new Map<string, GimmickSwitch>()
  const partsMap = new Map<string, GimmickPartController>()
  const choicesList: GimmickChoiceTree[] = []
  const reactionsList: GimmickReaction[] = []
  const commandsSet = new Set<string>()
  let hasIntimacy = false

  // 1. Scan captured motion groups
  for (const group of groups) {
    const groupName = group.name
    const entries = group.entries || []

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]
      if (!entry)
        continue

      // Check change_cos in Command / PostCommand / raw string fields
      for (const cmdField of ['Command', 'PostCommand', 'InitCommand'] as const) {
        const cmd = entry[cmdField]
        if (typeof cmd === 'string') {
          commandsSet.add(cmd)
          let match: RegExpExecArray | null
          // Reset regex
          CHANGE_COS_RE.lastIndex = 0
          while ((match = CHANGE_COS_RE.exec(cmd)) !== null) {
            if (match[1])
              costumesSet.add(match[1])
          }
        }
      }

      // Check VarFloats
      if (Array.isArray(entry.VarFloats)) {
        for (const vf of entry.VarFloats) {
          if (vf?.Name) {
            const varName = String(vf.Name)
            if (!switchesMap.has(varName)) {
              switchesMap.set(varName, {
                name: varName,
                code: vf.Code,
                type: vf.Type,
                currentValue: currentVarSnapshot[varName] ?? 0,
              })
            }
          }
        }
      }

      // Check Choices
      if (Array.isArray(entry.Choices) && entry.Choices.length > 0) {
        const opts: GimmickChoiceOption[] = []
        for (const ch of entry.Choices) {
          if (ch && typeof ch === 'object') {
            opts.push({
              text: String(ch.Text ?? 'Option'),
              nextMtn: ch.NextMtn,
            })
          }
        }
        if (opts.length > 0) {
          choicesList.push({
            parentGroup: groupName,
            text: entry.Text ? String(entry.Text) : undefined,
            choices: opts,
          })
        }
      }

      // Check Cutscenes / Voiced Reactions (Text + Sound/Motion, or sound-only voice lines)
      if (entry.Sound || (entry.Text && (entry.NextMtn || entry.Expression))) {
        reactionsList.push({
          group: groupName,
          index: i,
          text: entry.Text ? String(entry.Text) : groupName,
          sound: entry.Sound,
          expression: entry.Expression,
          nextMtn: entry.NextMtn,
        })
      }

      // Check Intimacy
      if (entry.Intimacy !== undefined) {
        hasIntimacy = true
      }
    }
  }

  // 2. Scan manifest HitAreas (tactile zones + menu routing) if provided
  const hitAreasList: GimmickHitArea[] = []
  if (rawSettings) {
    const rawHitAreas = rawSettings.HitAreas || rawSettings.hitAreas
    if (Array.isArray(rawHitAreas)) {
      for (const h of rawHitAreas) {
        const name = h?.Name ?? h?.name
        if (typeof name === 'string' && name) {
          hitAreasList.push({
            name,
            id: h?.Id ?? h?.id,
            motion: h?.Motion ?? h?.motion,
            enabled: (h?.Enabled ?? h?.enabled) !== false,
          })
        }
      }
    }
  }

  // 3. Scan manifest Controllers / ParamValue if provided
  if (rawSettings) {
    const controllers = rawSettings.Controllers || rawSettings.controllers
    const paramValue = controllers?.ParamValue || controllers?.paramValue || rawSettings.ParamValue
    const items = paramValue?.Items || paramValue?.items
    if (Array.isArray(items)) {
      for (const item of items) {
        if (item?.Name) {
          const name = String(item.Name)
          const ids = Array.isArray(item.Ids) ? item.Ids.map(String) : [name]
          const val = typeof item.Value === 'number' ? item.Value : 0.5
          partsMap.set(name, {
            name,
            ids,
            value: val,
            keyValues: item.KeyValues,
            min: item.Min ?? 0,
            max: item.Max ?? 1,
            step: item.Step ?? 0.01,
          })
        }
      }
    }
  }

  // Costumes list
  const costumesList: GimmickCostume[] = Array.from(costumesSet).map((file, slotIndex) => ({
    file,
    slotIndex,
  }))

  const hasDsl = costumesList.length > 0
    || switchesMap.size > 0
    || partsMap.size > 0
    || choicesList.length > 0
    || reactionsList.length > 0
    || hitAreasList.length > 0
    || commandsSet.size > 0
    || hasIntimacy

  return {
    hasDsl,
    costumes: costumesList,
    switches: Array.from(switchesMap.values()),
    parts: Array.from(partsMap.values()),
    choices: choicesList,
    reactions: reactionsList,
    hitAreas: hitAreasList,
    commands: Array.from(commandsSet),
    intimacy: {
      hasIntimacy,
      raw: intimacyRaw,
      display: Math.min(100, Math.round((intimacyRaw / 1000) * 100)),
    },
  }
}

export const introspectLive2dManifest = introspectCapabilities
