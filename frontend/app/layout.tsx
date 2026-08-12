import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Chhath Radio — छठ के गीत, बिना रुके",
  description:
    "A continuous Chhath Puja radio experience with a live 3D Ghat environment. Listen to devotional songs 24/7.",
  keywords: ["Chhath Puja", "Chhath songs", "छठ गीत", "Chhath Radio", "devotional music"],
  openGraph: {
    title: "Chhath Radio",
    description: "छठ के गीत, बिना रुके — Chhath Puja songs, non-stop.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="hi">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
