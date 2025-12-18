'use client'

import * as Headless from '@headlessui/react'
import clsx from 'clsx'
import { useState, useMemo } from 'react'

export default function MultiSelectCombobox<T extends { [k: string]: any }>({
  options,
  selectedIds = [],
  onChange,
  getId = (o: T) => (o as any).id,
  displayValue = (o: T | null) => (o ? String((o as any).name ?? '') : ''),
  placeholder,
  filter,
  className,
  'aria-label': ariaLabel,
}: {
  options: T[]
  selectedIds?: string[]
  onChange: (ids: string[]) => void
  getId?: (opt: T) => string
  displayValue?: (opt: T | null) => string
  placeholder?: string
  filter?: (opt: T, q: string) => boolean
  className?: string
  'aria-label'?: string
}) {
  const [query, setQuery] = useState('')

  const selected = useMemo(() => options.filter((o) => selectedIds.includes(getId(o))), [options, selectedIds, getId])

  const filtered = useMemo(() => {
    if (!query) return options
    const q = query.toLowerCase()
    return options.filter((o) => (filter ? filter(o, q) : String(displayValue(o)).toLowerCase().includes(q)))
  }, [options, query, filter, displayValue])

  return (
    <Headless.Combobox value={selected} onChange={(vals: T | T[] | null) => {
      // Headless returns array when multiple is true, but we keep single selection flow too
      if (Array.isArray(vals)) {
        onChange(vals.map((v) => getId(v)))
      } else if (vals) {
        const id = getId(vals as T)
        // toggle
        if (selectedIds.includes(id)) onChange(selectedIds.filter((x) => x !== id))
        else onChange([...selectedIds, id])
      }
    }} onClose={() => setQuery('')} multiple>
      {({ open }) => (
        <div className={clsx('relative', className)}>
          <Headless.ComboboxButton as="div" className="relative">
            <Headless.ComboboxInput
              className="w-full rounded-md bg-zinc-800 border border-zinc-700 p-2 pr-8 text-sm text-white cursor-pointer"
              displayValue={() => (selected.length ? selected.map((s) => displayValue(s)).filter(Boolean).join(', ') : '')}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={placeholder}
              aria-label={ariaLabel}
            />

            <div className="absolute inset-y-0 right-0 flex items-center pr-2 pointer-events-none">
              <svg className="w-4 h-4 stroke-zinc-400" viewBox="0 0 24 24" fill="none">
                <path d="M19 9l-7 7-7-7" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
          </Headless.ComboboxButton>

        <Headless.ComboboxOptions className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-md bg-zinc-900 border border-zinc-700 p-2">
          {filtered.length === 0 && <div className="text-sm text-gray-400 p-2">No hay resultados</div>}
          {filtered.map((opt) => {
            const id = getId(opt)
            const checked = selectedIds.includes(id)
            return (
              <Headless.Combobox.Option
                key={id}
                value={opt}
                className={({ active }) => clsx('flex items-center gap-3 p-2 rounded cursor-pointer', active ? 'bg-zinc-800' : '')}
              >
                <span className={clsx('w-5 h-5 flex items-center justify-center rounded-sm', checked ? 'bg-indigo-600' : 'bg-zinc-800 border border-zinc-700')}>
                  {checked ? (
                    <svg className="w-3 h-3 text-white" viewBox="0 0 16 16" fill="none">
                      <path d="M4 8.5l3 3L12 4" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" stroke="currentColor" />
                    </svg>
                  ) : (
                    <svg className="w-3 h-3 text-transparent" viewBox="0 0 16 16" fill="none" />
                  )}
                </span>

                <div className="flex flex-col">
                  <span className="text-sm text-white">{displayValue(opt)}</span>
                  {(opt as any).description && <span className="text-xs text-gray-400">{(opt as any).description}</span>}
                </div>
              </Headless.Combobox.Option>
            )
          })}
        </Headless.ComboboxOptions>
      </div>
      )}
    </Headless.Combobox>
  )
}
