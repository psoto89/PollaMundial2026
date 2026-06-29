'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, usePathname } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { POLLA2_PUBLIC } from '@/config/features'

const LiveLink = ({ onClick }: { onClick?: () => void }) => (
  <Link
    href="/live"
    onClick={onClick}
    className="flex items-center gap-1.5 text-[#768390] hover:text-[#e6edf3] transition-colors"
  >
    <span className="live-dot w-2 h-2 rounded-full bg-[#f85149] inline-block" />
    EN VIVO
  </Link>
)

export default function SiteNav() {
  const router = useRouter()
  const pathname = usePathname()
  const [authed, setAuthed] = useState<boolean | null>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(({ data }) => setAuthed(!!data.user))
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setAuthed(!!session?.user)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  // En el panel admin no mostramos el menú público (tiene su propio login/nav)
  if (pathname?.startsWith('/admin')) return null

  async function logout() {
    const supabase = createClient()
    await supabase.auth.signOut()
    setAuthed(false)
    setOpen(false)
    router.push('/')
    router.refresh()
  }

  // Enlaces que van dentro del menú (hamburguesa en móvil, fila en desktop)
  const menuLinks = (onClick?: () => void) => (
    <>
      <Link href="/grupos" onClick={onClick} className="text-[#768390] hover:text-[#e6edf3] transition-colors">
        Polla 1
      </Link>
      {POLLA2_PUBLIC && (
        <Link href="/eliminacion" onClick={onClick} className="text-[#768390] hover:text-[#e6edf3] transition-colors">
          Polla 2
        </Link>
      )}
      <Link href="/reglas" onClick={onClick} className="text-[#768390] hover:text-[#e6edf3] transition-colors">
        Reglas
      </Link>
      <Link href="/premiacion" onClick={onClick} className="text-[#768390] hover:text-[#e6edf3] transition-colors">
        Premio
      </Link>
      {authed === null ? null : authed ? (
        <>
          {POLLA2_PUBLIC && (
            <Link href="/mis-pronosticos" onClick={onClick} className="text-[#9EE637] font-medium hover:underline">
              Mi Polla
            </Link>
          )}
          <button onClick={() => { onClick?.(); logout() }} className="text-left text-[#768390] hover:text-[#e6edf3] transition-colors">
            Salir
          </button>
        </>
      ) : (
        <Link href="/login" onClick={onClick} className="text-[#768390] hover:text-[#e6edf3] transition-colors">
          Entrar
        </Link>
      )}
    </>
  )

  return (
    <>
      {/* Desktop: todo en fila */}
      <nav className="hidden sm:flex items-center gap-4 text-sm">
        <LiveLink />
        {menuLinks()}
      </nav>

      {/* Móvil: EN VIVO visible + hamburguesa */}
      <div className="flex sm:hidden items-center gap-3 text-sm">
        <LiveLink />
        <button
          onClick={() => setOpen((v) => !v)}
          aria-label="Menú"
          aria-expanded={open}
          className="flex flex-col justify-center gap-[5px] w-8 h-8 items-center"
        >
          <span className={`block h-0.5 w-5 bg-[#e6edf3] transition-transform ${open ? 'translate-y-[7px] rotate-45' : ''}`} />
          <span className={`block h-0.5 w-5 bg-[#e6edf3] transition-opacity ${open ? 'opacity-0' : ''}`} />
          <span className={`block h-0.5 w-5 bg-[#e6edf3] transition-transform ${open ? '-translate-y-[7px] -rotate-45' : ''}`} />
        </button>
      </div>

      {/* Panel desplegable (móvil) */}
      {open && (
        <div className="sm:hidden absolute top-14 left-0 right-0 bg-[#0d1117] border-b border-[#30363d] shadow-lg">
          <nav className="flex flex-col gap-4 px-4 py-4 text-base">
            {menuLinks(() => setOpen(false))}
          </nav>
        </div>
      )}
    </>
  )
}
