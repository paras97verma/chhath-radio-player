/**
 * Main Radio Page — Chhath Radio (Server Component)
 *
 * Exports metadata for SEO. All interactive UI is in PageClient.
 */

import PageClient from "@/components/radio/PageClient";

export const metadata = {
  title: "Chhath Radio — छठ के गीत, बिना रुके",
  description:
    "Listen to Chhath Puja songs 24/7. A continuous radio experience with a live 3D Ghat environment.",
};

export default function HomePage() {
  return <PageClient />;
}
