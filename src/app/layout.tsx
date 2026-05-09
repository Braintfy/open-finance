// PURPOSE: Корневой layout — шрифты, темы, метаданные
import type { Metadata, Viewport } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import { ThemeProvider } from '@/components/theme-provider';
import './globals.css';

const inter = Inter({
  subsets: ['latin', 'cyrillic'],
  variable: '--font-inter',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin', 'cyrillic'],
  variable: '--font-jetbrains-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: 'Open Finance — AI Финансовый Управляющий',
    template: '%s · Open Finance',
  },
  description:
    'Персональный AI-финансист для предпринимателей и фрилансеров: модули, AI-секретарь, налоги РФ, аналитика маркетплейсов. Доступно для каждого.',
  keywords: ['финансы', 'AI', 'налоги', 'маркетплейс', 'OZON', 'WB', 'УСН', 'ИП', 'аналитика'],
  authors: [{ name: 'Open Finance' }],
  metadataBase: new URL('https://openfinance.ru'),
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#FAFAFA' },
    { media: '(prefers-color-scheme: dark)', color: '#0A0A0A' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru" suppressHydrationWarning className={`${inter.variable} ${jetbrainsMono.variable}`}>
      <body className="min-h-screen bg-background font-sans text-foreground antialiased">
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
