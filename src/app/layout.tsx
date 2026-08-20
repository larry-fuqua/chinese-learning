import type { Metadata } from "next";
import { Noto_Serif_SC, Source_Sans_3, Source_Serif_4 } from "next/font/google";
import "./globals.css";

const serifSc = Noto_Serif_SC({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-serif",
  display: "swap",
});

const sourceSerif = Source_Serif_4({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-ui",
  display: "swap",
});

const sourceSans = Source_Sans_3({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Chinese Pronunciation Reader",
  description:
    "Read simplified Chinese, hear it, recite it, and compare tone contours.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="zh-Hans"
      className={`${serifSc.variable} ${sourceSerif.variable} ${sourceSans.variable}`}
    >
      <body className="min-h-screen font-[family-name:var(--font-ui)] antialiased">
        {children}
      </body>
    </html>
  );
}
