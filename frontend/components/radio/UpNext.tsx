"use client";

/**
 * Phase 7.2: UpNext Component
 *
 * Shows the next 3 songs in the queue.
 *
 * NOTE: We select `queue` and `currentIndex` as stable primitives from the
 * store, then derive `upNextSongs` inside the component body. This avoids
 * the "getSnapshot should be cached" infinite-loop warning that occurs when
 * a selector returns a new array reference on every render.
 */

import { useRadioStore } from "@/lib/radio-store";

export default function UpNext() {
  const queue = useRadioStore((s) => s.queue);
  const currentIndex = useRadioStore((s) => s.currentIndex);

  // Derive the next 3 songs from stable store primitives
  const upNextSongs = queue.slice(currentIndex + 1, currentIndex + 4);

  if (upNextSongs.length === 0) return null;

  return (
    <section aria-label="Up next" className="w-full max-w-sm">
      <h2 className="text-xs uppercase tracking-widest text-amber-400/60 mb-2 text-center">
        Up Next
      </h2>
      <ol className="space-y-1">
        {upNextSongs.map((song, i) => (
          <li
            key={song.id}
            className="flex items-center gap-3 px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 transition-colors"
          >
            <span className="text-amber-400/40 text-xs w-4 text-right shrink-0">
              {i + 1}
            </span>
            <div className="min-w-0">
              <p className="text-white/80 text-sm truncate">{song.title}</p>
              <p className="text-white/40 text-xs truncate">{song.artist}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}