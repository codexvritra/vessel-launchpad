import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";

// pools.trade / Uniswap use Basel Grotesk; Inter is the closest clean grotesk.
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Signapad — every NFT is a funded wallet",
  description:
    "A permissionless NFT launchpad where every token owns an ERC-6551 account funded at mint. The NFT is a wallet with assets inside it.",
};

// Set the theme attribute before paint to avoid a flash of the wrong theme.
// Default to dark (pools.trade-style) unless the user has explicitly chosen light.
const themeInitScript = `(function(){try{var m=localStorage.getItem('wallet-theme');var t=(m==='light'||m==='dark')?m:'dark';document.documentElement.setAttribute('data-theme',t);}catch(e){document.documentElement.setAttribute('data-theme','dark');}})();`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>
        <Providers>
          <div className="flex min-h-screen flex-col">
            <Header />
            <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 lg:px-8">
              {children}
            </main>
            <Footer />
          </div>
        </Providers>
      </body>
    </html>
  );
}
