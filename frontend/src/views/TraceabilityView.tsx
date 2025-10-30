import TraceabilityTable from '@/components/traceability/TraceabilityTable'
import { Button } from '@/components/ui/Button'
import { Heading } from '@/components/ui/Heading'

export default function TraceabilityView() {
  return (
    <div className="p-4 sm:p-6">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
          <Heading className="!text-2xl">Trazabilidad de accesos</Heading>
          <div className="w-full sm:w-auto flex flex-col sm:flex-row gap-2">
            <Button plain className="w-full sm:w-auto" onClick={() => window.dispatchEvent(new CustomEvent('traceability:clear-filters'))}>Limpiar filtros</Button>
            <Button className="w-full sm:w-auto" onClick={() => window.dispatchEvent(new CustomEvent('traceability:export-csv'))}>Exportar CSV</Button>
          </div>
        </div>

        <div>
          <div className="bg-white dark:bg-zinc-900 rounded-lg shadow p-3 sm:p-4 min-w-0">
            <TraceabilityTable />
          </div>
        </div>
      </div>
    </div>
  )
}
