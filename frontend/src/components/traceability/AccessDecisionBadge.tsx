import {
  CheckCircleIcon,
  ClockIcon,
  NoSymbolIcon,
  Square2StackIcon,
  XCircleIcon,
} from '@heroicons/react/16/solid'
import { Badge } from '@/components/ui/Badge'
import { getAccessDecisionMeta, isAccessDecision, type AccessDecision } from '@/helpers/accessDecision'

const DECISION_ICONS: Record<AccessDecision, typeof CheckCircleIcon> = {
  Permitido: CheckCircleIcon,
  Denegado: XCircleIcon,
  Duplicado: Square2StackIcon,
  Pendiente: ClockIcon,
  Expirado: NoSymbolIcon,
}

interface AccessDecisionBadgeProps {
  decision: string
}

export function AccessDecisionBadge({ decision }: AccessDecisionBadgeProps) {
  const { label, color, description } = getAccessDecisionMeta(decision)
  const Icon = isAccessDecision(decision) ? DECISION_ICONS[decision] : null

  return (
    <Badge color={color} title={description}>
      {Icon ? <Icon className="size-4" /> : null}
      {label}
    </Badge>
  )
}
