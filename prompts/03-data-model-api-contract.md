# CHHATH RADIO — Data Model & API Contract

## 1. Purpose

This document defines the persistent data model and public/admin API contract.

The database is authoritative for curated content.

---

# 2. SONGS

Suggested fields:

```text
id UUID PK
title VARCHAR
artist VARCHAR NULL
youtube_video_id VARCHAR
youtube_url TEXT
language VARCHAR NULL
category VARCHAR NULL
thumbnail_url TEXT NULL
enabled BOOLEAN
sort_order INTEGER
rights_notes TEXT NULL
created_at TIMESTAMP
updated_at TIMESTAMP
```

Constraints:

- YouTube video ID required
- enabled defaults to true
- sort_order defaults to 0
- timestamps required

---

# 3. CHANNELS

```text
id UUID PK
name VARCHAR
slug VARCHAR UNIQUE
description TEXT NULL
enabled BOOLEAN
sort_order INTEGER
created_at TIMESTAMP
updated_at TIMESTAMP
```

---

# 4. CHANNEL_SONGS

Many-to-many relationship:

```text
channel_id UUID FK
song_id UUID FK
sort_order INTEGER
```

Unique:

```text
(channel_id, song_id)
```

---

# 5. FESTIVAL_DAYS

```text
id UUID PK
festival_code VARCHAR
date DATE
state VARCHAR
title VARCHAR
description TEXT NULL
enabled BOOLEAN
```

Possible states:

```text
NAHAI_KHAI
KHARNA
SANDHYA_ARGHYA
USHA_ARGHYA
```

---

# 6. SITE_SETTINGS

Use key/value or structured configuration.

Examples:

```text
site_title
tagline
default_channel
default_quality
festival_timezone
```

Do not store secrets in general site settings.

---

# 7. ANALYTICS_EVENTS

Suggested:

```text
id UUID
event_name
song_id NULL
channel_id NULL
created_at
anonymous_session_id NULL
metadata JSONB NULL
```

Do not store unnecessary personal information.

---

# 8. ADMINS

The exact authentication implementation may vary.

Minimum conceptual fields:

```text
id
email/identifier
password_hash OR external_auth_identifier
role
enabled
created_at
updated_at
```

Never store plaintext passwords.

---

# 9. PUBLIC API

## GET /api/songs

Returns enabled public songs.

---

## GET /api/songs/{id}

Returns a public song.

---

## GET /api/channels

Returns enabled channels.

---

## GET /api/channels/{slug}

Returns channel metadata and curated songs.

---

## GET /api/radio/queue

Returns the curated radio queue.

Example:

```json
{
  "channel": {
    "id": "..."
  },
  "songs": [
    {
      "id": "...",
      "title": "Example Song",
      "artist": "Example Artist",
      "youtube_video_id": "..."
    }
  ]
}
```

---

## GET /api/festival/current

Returns:

```json
{
  "state": "SANDHYA_ARGHYA",
  "title": "संध्या अर्घ्य",
  "active": true
}
```

---

## GET /api/settings

Returns only safe public settings.

---

# 10. ADMIN API

## POST /api/admin/songs

Create song.

---

## PATCH /api/admin/songs/{id}

Update song.

---

## DELETE /api/admin/songs/{id}

Delete song.

---

## POST /api/admin/channels

Create channel.

---

## PATCH /api/admin/channels/{id}

Update channel.

---

## PATCH /api/admin/settings

Update allowed public settings.

---

# 11. STATUS CODES

Use:

```text
200 OK
201 Created
204 No Content
400 Bad Request
401 Unauthorized
403 Forbidden
404 Not Found
409 Conflict
422 Validation Error
429 Too Many Requests
500 Internal Server Error
```

---

# 12. ERROR FORMAT

Use:

```json
{
  "error": {
    "code": "SONG_NOT_FOUND",
    "message": "Song not found."
  }
}
```

Do not return stack traces.

---

# 13. API VALIDATION

Validate:

- UUIDs
- slugs
- YouTube URLs
- video IDs
- title lengths
- enum values
- pagination
- sort order

---

# 14. YOUTUBE URL NORMALIZATION

Accepted forms may include:

```text
youtube.com/watch?v=...
youtu.be/...
youtube.com/embed/...
```

Normalize to:

```text
youtube_video_id
```

The application should store the ID as the canonical playback identifier.

---

# 15. API VERSIONING

If breaking changes are introduced, use:

```text
/api/v2/
```

Do not silently break existing clients.

---

# 16. API CONTRACT PRINCIPLE

The frontend should never need database-specific knowledge.

The API exposes product concepts:

```text
Song
Channel
Radio Queue
Festival
Settings
```

not raw database implementation details.
