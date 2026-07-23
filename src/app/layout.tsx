import type { Metadata } from 'next'
import { Bricolage_Grotesque, DM_Mono } from 'next/font/google'
import './globals.css'

const bricolage = Bricolage_Grotesque({
  subsets: ['latin'],
  variable: '--font-sans',
  weight: ['300', '400', '500', '600', '700', '800'],
})

const dmMono = DM_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  weight: ['400', '500'],
})

export const metadata: Metadata = {
  title: 'Zutomate',
  description: 'Multi-client Instantly dashboard',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${bricolage.variable} ${dmMono.variable}`}>
        {children}
      </body>
    </html>
  )
}
