import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import './globals.css'
import Link from 'next/link'
import AuthNav from '@/components/nav/AuthNav'
import BrandLogo from '@/components/nav/BrandLogo'

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
})

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})

export const metadata: Metadata = {
  title: 'Mundial 2026',
  description: 'Tabla de posiciones y resultados en vivo de la polla del Mundial 2026',
  openGraph: {
    title: 'Mundial 2026',
    description: 'Tabla de posiciones y resultados en vivo',
    type: 'website',
  },
}

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="es"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased dark`}
    >
      <body className="min-h-full flex flex-col bg-[#0d1117] text-[#e6edf3]">
        {/* Navbar */}
        <header className="sticky top-0 z-50 border-b border-[#30363d] bg-[#0d1117]/90 backdrop-blur-sm">
          <div className="max-w-4xl mx-auto px-4 h-14 flex items-center justify-between">
            <BrandLogo />
            <nav className="flex items-center gap-4 text-sm">
              <Link
                href="/live"
                className="flex items-center gap-1.5 text-[#768390] hover:text-[#e6edf3] transition-colors"
              >
                <span className="live-dot w-2 h-2 rounded-full bg-[#f85149] inline-block" />
                EN VIVO
              </Link>
              <Link
                href="/reglas"
                className="text-[#768390] hover:text-[#e6edf3] transition-colors"
              >
                Reglas
              </Link>
              <Link
                href="/premiacion"
                className="text-[#768390] hover:text-[#e6edf3] transition-colors"
              >
                Premio
              </Link>
              <AuthNav />
            </nav>
          </div>
        </header>

        {/* Contenido principal */}
        <main className="flex-1 max-w-4xl mx-auto w-full px-4 py-6">
          {children}
        </main>

        {/* Footer */}
        <footer className="border-t border-[#30363d] py-4 text-center text-xs text-[#768390]">
          Mundial 2026 · Solo consulta
        </footer>
      </body>
    </html>
  )
}
