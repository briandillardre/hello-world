import type { EntityDataPack } from '@/lib/types'
import { riverbend } from './entities/riverbend'
import { greenvilleSc } from './entities/greenville-sc'

const PACKS: Record<string, EntityDataPack> = {
  [riverbend.entity.slug]: riverbend,
  [greenvilleSc.entity.slug]: greenvilleSc,
}

export function getPack(slug: string): EntityDataPack | null {
  return PACKS[slug] ?? null
}

export function listEntities(): EntityDataPack[] {
  return Object.values(PACKS)
}

export function entitySlugs(): string[] {
  return Object.keys(PACKS)
}
