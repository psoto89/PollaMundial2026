'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function AuthNav() {
  const router = useRouter()
  const [authed, setAuthed] = useState<boolean | null>(null)

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(({ data }) => setAuthed(!!data.user))
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setAuthed(!!session?.user)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  async function logout() {
    const supabase = createClient()
    await supabase.auth.signOut()
    setAuthed(false)
    router.push('/')
    router.refresh()
  }

  // Mientras carga la sesión, no mostramos nada para evitar parpadeo
  if (authed === null) return null

  if (!authed) {
    return (
      <Link href="/login" className="text-[#768390] hover:text-[#e6edf3] transition-colors">
        Entrar
      </Link>
    )
  }

  return (
    <>
      <Link
        href="/mis-pronosticos"
        className="text-[#9EE637] font-medium hover:underline transition-colors"
      >
        Mi Polla
      </Link>
      <button
        onClick={logout}
        className="text-[#768390] hover:text-[#e6edf3] transition-colors"
      >
        Salir
      </button>
    </>
  )
}
