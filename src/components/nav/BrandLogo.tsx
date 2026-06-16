'use client'

import { useState } from 'react'
import Link from 'next/link'

/**
 * Logo de marca. Usa /logo.png si existe; si no carga (no lo has subido aún),
 * cae a un 🏆. Para usar el logo oficial: deja el archivo en public/logo.png.
 */
export default function BrandLogo() {
  const [imgOk, setImgOk] = useState(true)

  return (
    <Link href="/" className="flex items-center gap-2 font-bold text-[#9EE637] tracking-tight text-lg">
      {imgOk ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src="/logo.png"
          alt="Mundial 2026"
          width={28}
          height={28}
          className="h-7 w-7 object-contain"
          onError={() => setImgOk(false)}
        />
      ) : (
        <span aria-hidden className="text-xl">🏆</span>
      )}
      Mundial 2026
    </Link>
  )
}
