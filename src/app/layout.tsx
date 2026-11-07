import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Team Desk',
  description: 'A simple shared workspace for tasks, meetings, and decisions.',
  robots: { index: false, follow: false },
  icons: { icon: '/icon.svg' },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
