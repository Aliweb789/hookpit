import type { ReactNode } from 'react';
import './globals.css';

export const metadata = {
  title: 'Hookpit',
  description: 'Self-hostable webhook inspector and API mocking tool',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="top">
          <a href="/" className="logo">🪝 Hookpit</a>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
