interface VigiliaMarkProps {
  className?: string
}

/**
 * Marca de Vigilia (arco con cruz sobre dos techos) en trazos finos, sin fondo
 * ni degradados: sobre negro enciende muy pocos píxeles, que es lo que pide el
 * salvapantallas de un AMOLED. Los techos toman `currentColor`.
 */
export function VigiliaMark({ className }: VigiliaMarkProps) {
  return (
    <svg
      viewBox="0 0 200 140"
      fill="none"
      aria-hidden="true"
      focusable="false"
      className={className}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <g stroke="#22d3ee" strokeWidth="9">
        <path d="M22 112A78 78 0 0 1 75.9 37.8" />
        <path d="M124.1 37.8A78 78 0 0 1 178 112" />
        <path d="M100 19V45M87 32H113" />
      </g>
      <g stroke="currentColor" strokeWidth="9">
        <path d="M26 114L68 78L110 114" />
        <path d="M90 114L132 78L174 114" />
      </g>
    </svg>
  )
}
