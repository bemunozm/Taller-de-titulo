import { UserIcon, PhoneIcon, TruckIcon, HomeIcon, DocumentTextIcon, CheckCircleIcon, XCircleIcon, ClockIcon } from '@heroicons/react/24/outline';
import { Subheading } from '@/components/ui/Heading';
import { Text, Strong } from '@/components/ui/Text';
import { Badge } from '@/components/ui/Badge';

export interface CollectedData {
  visitorName?: string;
  visitorRut?: string;
  visitorPhone?: string;
  vehiclePlate?: string;
  visitReason?: string;
  destinationHouse?: string;
  residentName?: string;
  residentResponse?: 'approved' | 'denied' | 'pending';
}

interface CollectedDataPanelProps {
  data: CollectedData;
}

export function CollectedDataPanel({ data }: CollectedDataPanelProps) {
  const hasData = Object.values(data).some(value => value !== undefined && value !== null);

  if (!hasData) {
    return (
      <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-xl border border-zinc-200 dark:border-zinc-800 p-6">
        <Subheading className="mb-4">Datos del Visitante</Subheading>
        <Text className="text-center py-8">
          Los datos se mostrarán aquí a medida que el conserje los recopile...
        </Text>
      </div>
    );
  }

  const getResponseBadge = (response?: 'approved' | 'denied' | 'pending') => {
    if (!response) return null;

    const config = {
      approved: { 
        text: 'Aprobado', 
        color: 'lime' as const,
        icon: <CheckCircleIcon className="w-3 h-3" />
      },
      denied: { 
        text: 'Rechazado', 
        color: 'red' as const,
        icon: <XCircleIcon className="w-3 h-3" />
      },
      pending: { 
        text: 'Pendiente', 
        color: 'yellow' as const,
        icon: <ClockIcon className="w-3 h-3" />
      },
    };

    const { text, color, icon } = config[response];

    return (
      <Badge color={color} className="flex items-center gap-1">
        {icon}
        {text}
      </Badge>
    );
  };

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-xl border border-zinc-200 dark:border-zinc-800 p-6">
      <Subheading className="mb-6">Datos del Visitante</Subheading>

      <div className="space-y-3">
        {/* Nombre */}
        {data.visitorName && (
          <div className="flex items-center gap-3 p-4 bg-zinc-50 dark:bg-zinc-800/50 rounded-xl border border-zinc-200 dark:border-zinc-700">
            <div className="flex-shrink-0 w-10 h-10 bg-blue-100 dark:bg-blue-900/30 rounded-lg flex items-center justify-center">
              <UserIcon className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            </div>
            <div className="flex-1 min-w-0">
              <Text className="text-xs mb-0.5">Nombre</Text>
              <Strong className="text-sm">{data.visitorName}</Strong>
            </div>
          </div>
        )}

        {/* RUT */}
        {data.visitorRut && (
          <div className="flex items-center gap-3 p-4 bg-zinc-50 dark:bg-zinc-800/50 rounded-xl border border-zinc-200 dark:border-zinc-700">
            <div className="flex-shrink-0 w-10 h-10 bg-purple-100 dark:bg-purple-900/30 rounded-lg flex items-center justify-center">
              <DocumentTextIcon className="w-5 h-5 text-purple-600 dark:text-purple-400" />
            </div>
            <div className="flex-1 min-w-0">
              <Text className="text-xs mb-0.5">RUT/Pasaporte</Text>
              <Strong className="text-sm font-mono">{data.visitorRut}</Strong>
            </div>
          </div>
        )}

        {/* Teléfono */}
        {data.visitorPhone && (
          <div className="flex items-center gap-3 p-4 bg-zinc-50 dark:bg-zinc-800/50 rounded-xl border border-zinc-200 dark:border-zinc-700">
            <div className="flex-shrink-0 w-10 h-10 bg-green-100 dark:bg-green-900/30 rounded-lg flex items-center justify-center">
              <PhoneIcon className="w-5 h-5 text-green-600 dark:text-green-400" />
            </div>
            <div className="flex-1 min-w-0">
              <Text className="text-xs mb-0.5">Teléfono</Text>
              <Strong className="text-sm font-mono">{data.visitorPhone}</Strong>
            </div>
          </div>
        )}

        {/* Patente */}
        {data.vehiclePlate && (
          <div className="flex items-center gap-3 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-xl border border-blue-200 dark:border-blue-800">
            <div className="flex-shrink-0 w-10 h-10 bg-blue-200 dark:bg-blue-800/50 rounded-lg flex items-center justify-center">
              <TruckIcon className="w-5 h-5 text-blue-700 dark:text-blue-300" />
            </div>
            <div className="flex-1 min-w-0">
              <Text className="text-xs mb-0.5 text-blue-700 dark:text-blue-300">Vehículo</Text>
              <Strong className="text-sm font-mono text-blue-900 dark:text-blue-100">{data.vehiclePlate.toUpperCase()}</Strong>
            </div>
          </div>
        )}

        {/* Casa de destino */}
        {data.destinationHouse && (
          <div className="flex items-center gap-3 p-4 bg-zinc-50 dark:bg-zinc-800/50 rounded-xl border border-zinc-200 dark:border-zinc-700">
            <div className="flex-shrink-0 w-10 h-10 bg-orange-100 dark:bg-orange-900/30 rounded-lg flex items-center justify-center">
              <HomeIcon className="w-5 h-5 text-orange-600 dark:text-orange-400" />
            </div>
            <div className="flex-1 min-w-0">
              <Text className="text-xs mb-0.5">Casa/Depto</Text>
              <Strong className="text-sm">#{data.destinationHouse}</Strong>
            </div>
          </div>
        )}

        {/* Motivo */}
        {data.visitReason && (
          <div className="p-4 bg-zinc-50 dark:bg-zinc-800/50 rounded-xl border border-zinc-200 dark:border-zinc-700">
            <Text className="text-xs mb-2">Motivo de visita</Text>
            <Text className="text-sm">{data.visitReason}</Text>
          </div>
        )}

        {/* Residente contactado */}
        {data.residentName && (
          <div className="p-4 bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-900/20 dark:to-emerald-900/20 rounded-xl border-2 border-green-200 dark:border-green-800">
            <Text className="text-xs mb-2 text-green-700 dark:text-green-300">Residente notificado</Text>
            <div className="flex items-center justify-between gap-3">
              <Strong className="text-sm text-green-900 dark:text-green-100">{data.residentName}</Strong>
              {getResponseBadge(data.residentResponse)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
