import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import ServiceWorkerRegistrar from "@/components/radio/ServiceWorkerRegistrar";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const SITE_URL = "https://chhathradio.com";

export const metadata: Metadata = {
  title: "Chhath Radio — छठ के गीत, बिना रुके",
  description:
    "Listen to Chhath Puja geet live, 24/7. A continuous devotional radio experience with a live 3D Ghat scene. Dedicated to Chhathi Maiya. 🪔",
  keywords: [
    "Chhath Puja", "Chhath songs", "छठ गीत", "Chhath Radio", "devotional music",
    "Chhath geet", "Bihar festival", "Surya Puja", "Chhathi Maiya", "Bhojpuri songs",
    "Chhath 2026", "online Chhath radio", "live Chhath music",
  ],
  metadataBase: new URL(SITE_URL),
  alternates: {
    canonical: SITE_URL,
  },
  openGraph: {
    title: "Chhath Radio 🪔 — छठ के गीत, बिना रुके",
    description: "Listen to Chhath Puja geet live, 24/7. Dedicated to Chhathi Maiya.",
    url: SITE_URL,
    siteName: "Chhath Radio",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "Chhath Radio — छठ के गीत, बिना रुके",
      },
    ],
    locale: "hi_IN",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Chhath Radio 🪔 — छठ के गीत, बिना रुके",
    description: "Listen to Chhath Puja geet live, 24/7. Dedicated to Chhathi Maiya.",
    images: ["/og-image.png"],
  },
  manifest: "/manifest.json",
  themeColor: "#f97316",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Chhath Radio",
  },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="hi">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://www.youtube.com" />
        <link rel="dns-prefetch" href="https://i.ytimg.com" />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <ServiceWorkerRegistrar />
        {children}
      </body>
    </html>
  );
}
