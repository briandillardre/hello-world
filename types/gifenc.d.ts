/**
 * gifenc ships no types. Only the four things lib/map-gif.ts uses are
 * declared, typed the way we actually call them — a blanket `declare module`
 * would turn every misuse into an `any` and hide a real mistake.
 */
declare module 'gifenc' {
  export type GifPalette = number[][]
  export interface WriteFrameOpts {
    /** Only the first frame carries the palette; the rest inherit it. */
    palette?: GifPalette
    /** Hundredths-of-a-second granularity, in milliseconds. */
    delay?: number
    transparent?: boolean
    transparentIndex?: number
    dispose?: number
    repeat?: number
  }
  export interface GifEncoderHandle {
    writeFrame(index: Uint8Array, width: number, height: number, opts?: WriteFrameOpts): void
    finish(): void
    bytes(): Uint8Array
    bytesView(): Uint8Array
    reset(): void
  }
  export function GIFEncoder(opts?: { auto?: boolean; initialCapacity?: number }): GifEncoderHandle
  export function quantize(
    rgba: Uint8Array | Uint8ClampedArray,
    maxColors: number,
    opts?: { format?: 'rgb565' | 'rgb444' | 'rgba4444'; oneBitAlpha?: boolean | number; clearAlpha?: boolean },
  ): GifPalette
  export function applyPalette(
    rgba: Uint8Array | Uint8ClampedArray,
    palette: GifPalette,
    format?: 'rgb565' | 'rgb444' | 'rgba4444',
  ): Uint8Array
}
