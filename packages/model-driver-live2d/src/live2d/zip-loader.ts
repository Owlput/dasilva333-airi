/**
 * The zip support `pixi-live2d-display` expects a host to provide.
 *
 * Its `ZipLoader` ships with `zipReader`/`getFilePaths`/`getFiles`/`readText` as `throw new Error('Not implemented')`
 * and leaves the archive implementation to the embedder. A Live2D driver stores what the user imported, which is a
 * `.zip`, so it has to supply them — with JSZip, which is already the archive reader this repository uses.
 *
 * Deliberately smaller than the legacy renderer's patched loader: no OPFS cache, no DSL capture, no mojibake repair.
 * A driver loads from its own bytes and reports a missing file as a load failure instead of manufacturing an empty
 * motion or physics file, because a silently substituted asset renders something the author never made.
 */
import JSZip from 'jszip'

import { Cubism4ModelSettings, ZipLoader } from 'pixi-live2d-display/cubism4'

function isMacOSJunk(path: string): boolean {
  const parts = path.split('/')
  return parts.some(part => part === '__MACOSX' || part.startsWith('._') || part === '.DS_Store')
}

function basename(path: string): string {
  return path.split('/').pop() ?? path
}

function findEntry(reader: JSZip, path: string): JSZip.JSZipObject | null {
  const direct = reader.file(path)
  if (direct)
    return direct

  const lower = path.toLowerCase()
  const files = Object.keys(reader.files).filter(key => !reader.files[key].dir && !isMacOSJunk(key))
  const caseMatch = files.find(key => key.toLowerCase() === lower)
  if (caseMatch)
    return reader.file(caseMatch)

  // Archive tools disagree about the leading directory, so a basename match is the last honest fallback.
  const base = basename(path).toLowerCase()
  const baseMatch = files.find(key => key.toLowerCase() === base || key.toLowerCase().endsWith(`/${base}`))
  return baseMatch ? reader.file(baseMatch) : null
}

ZipLoader.zipReader = (data: Blob) => JSZip.loadAsync(data.arrayBuffer())

ZipLoader.getFilePaths = async (reader: JSZip) =>
  Object.keys(reader.files).filter(path => !reader.files[path].dir && !isMacOSJunk(path))

ZipLoader.getFiles = async (reader: JSZip, paths: string[]) =>
  Promise.all(paths.map(async (path) => {
    const entry = findEntry(reader, path)
    if (!entry)
      throw new Error(`The Live2D archive is missing \`${path}\``)
    return new File([await entry.async('blob')], basename(path))
  }))

ZipLoader.readText = async (reader: JSZip, path: string) => {
  const entry = findEntry(reader, path)
  if (!entry)
    throw new Error(`The Live2D archive is missing \`${path}\``)
  return entry.async('text')
}

const defaultCreateSettings = ZipLoader.createSettings
ZipLoader.createSettings = async (reader: JSZip) => {
  const settings = await defaultCreateSettings(reader)

  // NOTICE: authoring tools leave `""` texture slots behind for costume swaps. PIXI's texture loader then fetches
  // the empty string and crashes on a 404, which surfaces to the user as "the model did not load" with no cause.
  const textures = (settings as unknown as { textures?: unknown }).textures
  if (Array.isArray(textures))
    (settings as unknown as { textures: unknown[] }).textures = textures.filter(texture => typeof texture === 'string' && texture.trim().length > 0)

  // `null` is not `undefined` to the library's own checks (`if (this.physics !== void 0)`), so a `null` file
  // reference would reach URL resolution and throw on a null path.
  for (const key of ['physics', 'pose'] as const) {
    const holder = settings as unknown as Record<string, unknown>
    if (holder[key] === null)
      holder[key] = undefined
  }

  return settings
}

export { Cubism4ModelSettings }
