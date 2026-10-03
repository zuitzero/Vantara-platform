import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import '../src/app/globals.css';

export const metadata: Metadata = {
  title: 'Vantara',
  description: 'Connected hotel operations platform',
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

