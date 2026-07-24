import type { Metadata } from 'next'
import { Manrope, DM_Mono } from 'next/font/google'
import './globals.css'

// Clean, modern grotesque matching the Zutomate site — kept to moderate
// weights so headings read confident, not heavy.
const sans = Manrope({
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
