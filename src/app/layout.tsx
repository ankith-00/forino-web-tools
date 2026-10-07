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