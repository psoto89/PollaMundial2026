import Link from 'next/link'

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#0d1117]">
      <header className="sticky top-0 z-50 border-b border-[#30363d] bg-[#0d1117]/90 backdrop-blur-sm">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/admin" className="font-bold text-[#9EE637] text-sm">
              ⚙️ Admin
            </Link>
            <nav className="flex items-center gap-3 text-sm">
              <Link href="/admin/import" className="text-[#768390] hover:text-[#e6edf3] transition-colors">
                Importar Excel
              </Link>
              <Link href="/admin/results" className="text-[#768390] hover:text-[#e6edf3] transition-colors">
                Resultados
              </Link>
            </nav>
          </div>
          <Link href="/" className="text-xs text-[#768390] hover:text-[#e6edf3]">
            Ver web pública →
          </Link>
        </div>
      </header>
      <main className="max-w-5xl mx-auto px-4 py-6">
        {children}
      </main>
    </div>
  )
}
