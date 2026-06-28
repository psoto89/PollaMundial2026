import { flagUrl } from '@/config/flags'

/**
 * Bandera de un equipo (imagen desde flagcdn). Si el equipo no está mapeado,
 * muestra un ⚽ como fallback. `size` es el alto en px (la imagen mantiene ratio 4:3).
 */
export default function TeamFlag({
  nombre,
  size = 18,
  className = '',
}: {
  nombre: string | null | undefined
  size?: number
  className?: string
}) {
  const src = flagUrl(nombre, size > 40 ? 80 : 40)
  const width = Math.round((size * 4) / 3)

  if (!src) {
    return (
      <span
        className={`inline-flex items-center justify-center shrink-0 ${className}`}
        style={{ width, height: size }}
        aria-hidden
      >
        ⚽
      </span>
    )
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={nombre ?? ''}
      width={width}
      height={size}
      loading="lazy"
      decoding="async"
      className={`inline-block shrink-0 rounded-[2px] object-cover ${className}`}
      style={{ width, height: size }}
    />
  )
}
