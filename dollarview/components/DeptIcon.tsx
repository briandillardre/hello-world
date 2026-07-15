import {
  Banknote,
  Building2,
  Droplets,
  Flame,
  Landmark,
  Layers,
  Shield,
  Trees,
  Truck,
  CircleDollarSign,
  type LucideIcon,
} from 'lucide-react'

const ICONS: Record<string, LucideIcon> = {
  shield: Shield,
  flame: Flame,
  truck: Truck,
  trees: Trees,
  landmark: Landmark,
  'building-2': Building2,
  banknote: Banknote,
  droplets: Droplets,
  layers: Layers,
}

export function DeptIcon({ name, className }: { name: string; className?: string }) {
  const Icon = ICONS[name] ?? CircleDollarSign
  return <Icon className={className} aria-hidden />
}
