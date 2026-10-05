import { cache } from "react";
import type { Metadata } from "next";
import Script from "next/script";
import { Lexend, Merriweather, JetBrains_Mono } from "next/font/google";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { SiteBrandingProvider } from "@/components/layout/SiteBrandingProvider";
import { createClient } from "@/utils/supabase/server";
import { DEFAULT_BRANDING, resolveSiteTitle, userBranding } from "@/lib/site-branding";
import "./globals.css";

const fontSans = Lexend({
  subsets: ["latin"],
  variable: "--font-sans",
});

const fontSerif = Merriweather({
  subsets: ["latin"],
  variable: "--font-serif",
});

const fontMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
});

const loadBranding = cache(async () => {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return userBranding(user);
  } catch {
    // Never let a branding read take a page down; the defaults render fine.
    return DEFAULT_BRANDING;
  }
});


export async function generateMetadata(): Promise<Metadata> {
  const branding = await loadBranding();

  return {
    title: resolveSiteTitle(branding),
    description: "Author: https://www.ankith.dev",
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const branding = await loadBranding();

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* `next/script`, not a bare <script> element. React never executes a script
            tag it renders on the client, so a plain one only worked because the server
            happened to emit it — and it warned on every render. `beforeInteractive` is
            the supported way to get code into the document before hydration, which is
            the whole point here: it has to paint the theme before first paint, and it
            is injected into <head> from the server regardless of where it sits in the
            tree.

            Reads the same key `ThemeProvider` writes (its `storageKey` default in
            `@/components/theme/theme-provider`). The two must stay in step, or the
            page would paint the wrong theme here and then correct itself on hydration. */}
        <Script id="util-hub-theme-init" strategy="beforeInteractive">{`(function(){try{var s=localStorage.getItem("util-hub-theme");var d=s? s==="dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;document.documentElement.classList.toggle("dark",d);}catch(e){}})();`}</Script>
      </head>
      <body className={`${fontSans.variable} ${fontSerif.variable} ${fontMono.variable} antialiased`}>
        <SiteBrandingProvider branding={branding}>
          <ThemeProvider>{children}</ThemeProvider>
        </SiteBrandingProvider>
      </body>
    </html>
  );
}