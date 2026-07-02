import type { Metadata } from 'next'
import './globals.css'
import AppProviders from '@/components/AppProviders'

export const metadata: Metadata = {
  title: 'Cadence - AI Calendar App',
  description: 'AI-powered calendar app that helps students learn and manage time',
  icons: {
    icon: '/cadence-logo-black.png',
    apple: '/cadence-logo-black.png',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  )
}

