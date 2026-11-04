type PlayerRecoveryPanelProps = {
  error: string | null;
  canRetry: boolean;
  canSkip: boolean;
  onRetry: () => void;
  onSkip: () => void;
};

export default function PlayerRecoveryPanel({
  error,
  canRetry,
  canSkip,
  onRetry,
  onSkip,
}: PlayerRecoveryPanelProps) {
  return (
    <div
      className="mx-3 sm:mx-5 mt-3 rounded-2xl border border-rose-300/20 bg-gradient-to-br from-rose-950/55 via-[#21100d]/90 to-orange-950/35 p-3 sm:p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"
      role="alert"
      aria-live="assertive"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-rose-50">Playback was interrupted</p>
          <p className="mt-1 text-xs leading-relaxed text-rose-100/70">
            {error || "The stream stopped responding. Try this song again or skip to the next one."}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={onRetry}
            disabled={!canRetry}
            className="min-h-10 flex-1 rounded-xl bg-gradient-to-r from-amber-300 via-orange-400 to-orange-500 px-4 text-xs font-bold text-[#241006] shadow-[0_6px_18px_rgba(249,115,22,0.22)] transition hover:brightness-110 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 sm:flex-none"
          >
            Retry song
          </button>
          <button
            type="button"
            onClick={onSkip}
            disabled={!canSkip}
            aria-label="Skip this song and play the next song"
            title={!canSkip ? "Add another song to skip" : "Skip this song"}
            className="min-h-10 flex-1 rounded-xl border border-white/12 bg-white/[0.06] px-4 text-xs font-semibold text-white/85 transition hover:border-white/25 hover:bg-white/10 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 sm:flex-none"
          >
            Skip song
          </button>
        </div>
      </div>
    </div>
  );
}
