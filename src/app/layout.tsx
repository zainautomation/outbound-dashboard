import type { Metadata } from 'next'
import { Bricolage_Grotesque, DM_Mono } from 'next/font/google'
import './globals.css'

// The Zutomate brand font. Headings use bold (700), not extrabold, so it
// reads confident rather than heavy.
const sans = Bricolage_Grotesque({
  subsets: ['latin'],
  variable: '--font-sans',
  weight: ['400', '500', '600', '700', '800'],
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
      <body className={`${sans.variable} ${dmMono.variable}`}>
        {children}
      </body>
    </html>
  )
}
