/**
 * DOM image conversion helpers for the sticker transparency flow.
 * Kept in a dedicated module (not the store) so unit tests can stub the
 * browser surface via `vi.mock`. No persistence here — blobs must never pass
 * through `JSON.stringify`; see airi-binary-safety.
 */

export async function blobToImageData(blob: Blob): Promise<ImageData> {
  const bitmap = await createImageBitmap(blob)
  try {
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const ctx = canvas.getContext('2d')
    if (!ctx)
      throw new Error('2d canvas context unavailable')
    ctx.drawImage(bitmap, 0, 0)
    return ctx.getImageData(0, 0, canvas.width, canvas.height)
  }
  finally {
    bitmap.close?.()
  }
}

export async function imageDataToPngBlob(image: ImageData): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = image.width
  canvas.height = image.height
  const ctx = canvas.getContext('2d')
  if (!ctx)
    throw new Error('2d canvas context unavailable')
  ctx.putImageData(image, 0, 0)
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'))
  if (!blob)
    throw new Error('canvas.toBlob produced no output')
  return blob
}
