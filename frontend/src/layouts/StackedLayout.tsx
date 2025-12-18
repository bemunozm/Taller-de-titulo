'use client'

import * as Headless from '@headlessui/react'
import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { NavbarItem } from '@/components/ui/Navbar'
import { SidebarItem } from '@/components/ui/Sidebar'
import { Outlet, useLocation } from 'react-router-dom'

function OpenMenuIcon() {
  return (
    <svg data-slot="icon" viewBox="0 0 20 20" aria-hidden="true">
      <path d="M2 6.75C2 6.33579 2.33579 6 2.75 6H17.25C17.6642 6 18 6.33579 18 6.75C18 7.16421 17.6642 7.5 17.25 7.5H2.75C2.33579 7.5 2 7.16421 2 6.75ZM2 13.25C2 12.8358 2.33579 12.5 2.75 12.5H17.25C17.6642 12.5 18 12.8358 18 13.25C18 13.6642 17.6642 14 17.25 14H2.75C2.33579 14 2 13.6642 2 13.25Z" />
    </svg>
  )
}

function CloseMenuIcon() {
  return (
    <svg data-slot="icon" viewBox="0 0 20 20" aria-hidden="true">
      <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
    </svg>
  )
}

function MobileSidebar({ open, close, children }: React.PropsWithChildren<{ open: boolean; close: () => void }>) {
  return (
    <Headless.Dialog open={open} onClose={close} className="lg:hidden">
      <Headless.DialogBackdrop
        transition
        className="fixed inset-0 bg-black/30 transition data-closed:opacity-0 data-enter:duration-300 data-enter:ease-out data-leave:duration-200 data-leave:ease-in z-40"
      />
      <Headless.DialogPanel
        transition
        className="fixed inset-y-0 w-full max-w-80 p-2 transition duration-300 ease-in-out data-closed:-translate-x-full z-50"
      >
        <div className="flex h-full flex-col rounded-lg bg-white shadow-xs ring-1 ring-zinc-950/5 dark:bg-zinc-900 dark:ring-white/10">
          <div className="-mb-3 px-4 pt-3">
            <Headless.CloseButton as={NavbarItem} aria-label="Close navigation">
              <CloseMenuIcon />
            </Headless.CloseButton>
          </div>
          {children}
        </div>
      </Headless.DialogPanel>
    </Headless.Dialog>
  )
}

export function StackedLayout({
  navbar,
  sidebar,
}: React.PropsWithChildren<{ navbar?: React.ReactNode; sidebar?: React.ReactNode }>) {
  let [showSidebar, setShowSidebar] = useState(false)
  const location = useLocation()
  const navigate = useNavigate()
  const { data: user, isError, isLoading } = useAuth()

  // Redirigir a la pantalla de login si el usuario no está autenticado
  useEffect(() => {
    // esperar a que termine la carga
    if (isLoading) return
    const path = location.pathname || ''
    // si no hay usuario y no estamos ya en las rutas de auth, redirigir
    if ((!user || isError) && !path.startsWith('/auth')) {
      navigate('/auth/login')
    }
  }, [user, isError, isLoading, navigate, location.pathname])

  // Recorre un árbol de React nodes y marca como `current` los NavbarItem/SidebarItem
  function markActive(node: React.ReactNode): React.ReactNode {
    if (!React.isValidElement(node)) return node

    // procesa children recursivamente
    const children = (node as any).props?.children
    const newChildren = React.Children.map(children, (child) => markActive(child))

    // si el elemento es NavbarItem o SidebarItem, comprobar prop `to` o `href`
    const elementType = (node.type as any)
    const isNavItem = elementType === NavbarItem || elementType === SidebarItem

    if (isNavItem) {
      const props: any = (node as any).props || {}
      const link = props.to ?? props.href
      if (typeof link === 'string') {
        // marcar current si coincide exactamente o si es prefijo (para secciones)
        const isCurrent = link === location.pathname || (link !== '/' && location.pathname.startsWith(link))
        if (isCurrent) {
          return React.cloneElement(node, { ...(props as any), current: true, children: newChildren ?? props.children })
        }
      }
    }

    // si hubo children transformados, devolver clon con children nuevos
    if (newChildren !== undefined) {
      return React.cloneElement(node, { ...( (node as any).props as any ), children: newChildren })
    }

    return node
  }

  return (
    <div className="relative flex min-h-svh w-full flex-col bg-white lg:bg-zinc-100 dark:bg-zinc-900 dark:lg:bg-zinc-950">
      {/* Sidebar on mobile */}
      <MobileSidebar open={showSidebar} close={() => setShowSidebar(false)}>
        {sidebar}
      </MobileSidebar>

      {/* Navbar */}
      <header className="flex items-center px-4 relative z-10">
        <div className="py-2.5 lg:hidden">
          <NavbarItem onClick={() => setShowSidebar(true)} aria-label="Open navigation">
            <OpenMenuIcon />
          </NavbarItem>
        </div>
        <div className="min-w-0 flex-1 flex items-center gap-4">
          <div className="flex-1">{markActive(navbar) ?? null}</div>
        </div>
      </header>

      {/* Content */}
      <main className="flex flex-1 flex-col pb-2 lg:px-2">
        <div className="grow p-6 lg:rounded-lg lg:bg-white lg:p-10 lg:shadow-xs lg:ring-1 lg:ring-zinc-950/5 dark:lg:bg-zinc-900 dark:lg:ring-white/10">
          <div className="mx-auto max-w-6xl"><Outlet /></div>
        </div>
      </main>
    </div>
  )
}
