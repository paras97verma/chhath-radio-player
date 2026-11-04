# Data Model: Stream Cache and Playback Attempt

The application cache stores metadata only; browser transient playback buffers are outside this cache service.

## SongSourceCache

One Redis record per video ID: schema_version, video_id, generation, fence_token, refreshed_at, sources[0..2], last_resolution. It is served only when generation and token match the separate fence key.

## SongCacheFence

One non-expiring Redis fence key per video ID: generation (monotonic while the fence key exists) and a random fence_token. Every refresh or eviction atomically advances generation and rotates the token before upstream work. Missing fence means cache miss; a commit with an absent or mismatched token is rejected. Token, not the counter, is authoritative after Redis restart/key loss.

## SourceCandidate

Fields: mode (direct|proxy), provider (configured Invidious origin), url (signed direct URL or raw Invidious latest-version local endpoint), itag, mime_type/codec, resolved_at, expires_at (nullable), refresh_at, validation_state. Validation means metadata, format, and expiry were checked; it does not claim that an individual listener can reach the media URL.

Known expiry is valid only when more than 600s remains. Unknown-expiry metadata is valid for at most 1800s. Candidate deadlines are authoritative; Redis TTL retains record only. Valid alternate may remain only in current generation.

## CatalogWarmState

Fields: video_id, last_attempt_at, next_attempt_at, status (fresh/direct_only/proxy_only/failed/overdue), retry_count, bounded last_error. Derived from candidates and retry schedule, never TTL alone.

## PlaybackAttempt

Fields: request_generation, video_id, candidate_mode/provider, cache_generation, state (resolving/ready/buffering/playing/waiting/retrying/failed), last_progress_at (monotonic), retries_used, deadline, queue_index.

Client failure reports carry request generation, candidate mode/provider, cache generation, timestamp, and reason as telemetry only; they never mutate shared candidate validity or provider health.

## Invariants

- Song has zero to two current source candidates.
- Playback tries direct then proxy; bounded automatic retries are scoped to one recovery episode and cannot reuse a failed candidate after its retry budget is exhausted.
- Source failure never changes queue index. Retry preserves song; Skip is explicit.
- Redis eviction/restart is a miss. No audio bytes, browser URL persistence, or prior-generation fallback.

