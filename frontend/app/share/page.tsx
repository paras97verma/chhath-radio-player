/**
 * /share — Shareable "Now Playing" card page.
 *
 * Usage:
 *   /share?title=Kaanch+Hi+Baans&artist=Sharda+Sinha
 *
 * This page renders a beautiful full-screen card optimised for:
 *   - Instagram Stories screenshots
 *   - WhatsApp link previews (via OG meta tags)
 *   - Twitter/X cards
 *
 * The RadioPlayer writes the current song into the URL when the user
 * taps the "Share" button, so the OG image always reflects the live song.
 */

import type { Metadata } from "next";

interface SharePageProps {
  searchParams: Promise<{ title?: string; artist?: string }>;
}

export async function generateMetadata(
  { searchParams }: SharePageProps
): Promise<Metadata> {
  const params = await searchParams;
  const title = params.title ?? "Chhath Radio";
  const artist = params.artist ?? "छठ के गीत, बिना रुके";

  return {
    title: `${title} — Chhath Radio`,
    description: `Now playing: "${title}" by ${artist} on Chhath Radio 🪔`,
    openGraph: {
      title: `🪔 ${title}`,
      description: `${artist} — Chhath Radio | छठ के गीत, बिना रुके`,
      url: "https://chhath-radio-ten.vercel.app",
      siteName: "Chhath Radio",
      images: [
        {
          url: `/share/og-image?title=${encodeURIComponent(title)}&artist=${encodeURIComponent(artist)}`,
          width: 1200,
          height: 630,
          alt: `Now Playing: ${title} by ${artist}`,
        },
      ],
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title: `🪔 ${title} — Chhath Radio`,
      description: `${artist} | छठ के गीत, बिना रुके`,
    },
  };
}

export default async function SharePage({ searchParams }: SharePageProps) {
  const params = await searchParams;
  const title = params.title ?? "Chhath Radio";
  const artist = params.artist ?? "छठ के गीत, बिना रुके";

  const homeUrl = "https://chhath-radio-ten.vercel.app";

  return (
    <main className="min-h-screen w-full bg-[#0a0a2e] flex items-center justify-center p-4">
      {/* Card */}
      <div
        className={[
          "relative w-full max-w-lg rounded-3xl overflow-hidden",
          "bg-gradient-to-br from-[#1a1a4e] via-[#0d1b4b] to-[#0a0a2e]",
          "border border-amber-400/20",
          "shadow-[0_0_80px_rgba(251,191,36,0.15)]",
          "p-8 flex flex-col items-center gap-6 text-center",
        ].join(" ")}
      >
        {/* Decorative glow */}
        <div
          className="absolute inset-0 pointer-events-none"
          aria-hidden="true"
          style={{
            background:
              "radial-gradient(ellipse at 50% 0%, rgba(251,191,36,0.12) 0%, transparent 70%)",
          }}
        />

        {/* Diya emoji */}
        <div className="text-6xl select-none" aria-hidden="true">
          🪔
        </div>

        {/* Station name */}
        <p className="text-amber-400/70 text-xs uppercase tracking-[0.25em] font-semibold">
          Chhath Radio · LIVE
        </p>

        {/* Song info */}
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl md:text-4xl font-bold text-white leading-tight">
            {title}
          </h1>
          <p className="text-amber-200/80 text-lg">{artist}</p>
        </div>

        {/* Divider */}
        <div className="w-16 h-px bg-amber-400/30" aria-hidden="true" />

        {/* Tagline */}
        <p className="text-amber-200/50 text-sm">
          छठ के गीत, बिना रुके
        </p>

        {/* CTA */}
        <a
          href={homeUrl}
          className={[
            "mt-2 inline-flex items-center gap-2 px-6 py-3 rounded-full",
            "bg-amber-400 hover:bg-amber-300 active:bg-amber-500",
            "text-[#0a0a2e] font-bold text-sm",
            "transition-colors duration-150",
            "shadow-[0_0_20px_rgba(251,191,36,0.4)]",
          ].join(" ")}
        >
          🎵 Abhi suno — chhathradio.com
        </a>

        {/* Floating diyas (decorative) */}
        <div
          className="absolute bottom-4 left-0 right-0 flex justify-around px-8 opacity-20 select-none pointer-events-none"
          aria-hidden="true"
        >
          {["🪔", "🪔", "🪔", "🪔", "🪔"].map((d, i) => (
            <span key={i} className="text-lg">
              {d}
            </span>
          ))}
        </div>
      </div>

      {/* Back link */}
      <div className="fixed bottom-6 left-0 right-0 flex justify-center">
        <a
          href={homeUrl}
          className="text-amber-200/40 hover:text-amber-200/70 text-xs transition-colors"
        >
          ← Wapas Chhath Radio par jaayein
        </a>
      </div>
    </main>
  );
}