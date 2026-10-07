import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'Rolê da Extensão · PROEX UFG',
  description: 'Roleta e Super Dado do Rolê da Extensão da PROEX UFG. Sorteie brindes e configure a duração, o som e os efeitos.',
  icons: { icon: '/favicon.svg', shortcut: '/favicon.svg' },
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="pt-BR"><body>{children}</body></html>;
}
