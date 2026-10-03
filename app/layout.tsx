import type { Metadata, Viewport } from 'next';
import { THEME_KEY } from '@/lib/theme';
import './globals.css';

export const metadata: Metadata = {
  title: 'Bealach: Ireland’s trains, live',
  description: 'Every Irish Rail, DART and commuter train on a live map, with delays and next stops. Free and open source.',
  icons: { icon: '/icon.svg' },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f5f5f7' },
    { media: '(prefers-color-scheme: dark)', color: '#000000' },
  ],
  // The map handles pinch zoom itself.
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // The inline script sets data-theme before hydration, so React is told not to mind.
    <html lang="en-IE" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem('${THEME_KEY}');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}`,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
