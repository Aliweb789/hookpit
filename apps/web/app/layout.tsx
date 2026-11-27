import Link from 'next/link';
import type { ReactNode } from 'react';
import { GithubIcon, LogoMark } from './icons';
import './globals.css';

export const metadata = {
  title: 'Hookpit: webhook inspector, replay and mock responses',
  description: 'A self-hostable webhook inspector. Capture any HTTP request, replay it to your app, and mock the response.',
};

const REPO = 'https://github.com/Aliweb789/hookpit';

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="top">
          <div className="top-inner">
            <Link href="/" className="logo" aria-label="Hookpit home">
              <span className="logo-mark">
                <LogoMark />
              </span>
              Hookpit
            </Link>
            <nav aria-label="Project links">
              <a className="nav-link" href={REPO} target="_blank" rel="noopener noreferrer">
                <GithubIcon />
                <span>GitHub</span>
              </a>
            </nav>
          </div>
        </header>

        <main className="container">{children}</main>

        <footer className="foot">
          <div className="foot-inner">
            <span>Hookpit · MIT licensed · your payloads stay on your server</span>
            <span>
              <a href={REPO} target="_blank" rel="noopener noreferrer">Source</a>
              {' · '}
              <a href={`${REPO}/issues`} target="_blank" rel="noopener noreferrer">Issues</a>
              {' · '}
              <a href={`${REPO}/blob/main/CONTRIBUTING.md`} target="_blank" rel="noopener noreferrer">Contribute</a>
            </span>
          </div>
        </footer>
      </body>
    </html>
  );
}
