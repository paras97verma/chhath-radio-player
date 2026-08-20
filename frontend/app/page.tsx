/**
 * Main Radio Page — Chhath Radio (Server Component)
 *
 * Exports metadata for SEO. All interactive UI is in PageClient.
 * Songs are pre-fetched server-side so the client receives them in the
 * initial HTML — eliminating the client-side network round-trip on mount.
 */

import PageClient from "@/components/radio/PageClient";
import { fetchRadioQueue, Song } from "@/lib/api";

export const metadata = {
  title: "Chhath Radio — छठ के गीत, बिना रुके",
  description:
    "Listen to Chhath Puja songs 24/7. A continuous radio experience with a live 3D Ghat environment.",
};

export default async function HomePage() {
  // Pre-fetch the queue on the server. On failure, fall back to [] so the
  // client can still load (Effect A in RadioPlayer will retry).
  let initialSongs: Song[] = [];
  try {
    initialSongs = await fetchRadioQueue();
  } catch {
    // Silently fall back — RadioPlayer will fetch client-side as before.
  }

  return <PageClient initialSongs={initialSongs} />;
}
