# CHHATH RADIO — Content & Catalog Management Specification

## 1. Purpose

CHHATH RADIO is curated.

The catalog must not behave like an uncontrolled YouTube search engine.

Songs are intentionally selected and organized.

---

# 2. Song Metadata

Each song should contain:

```text
Title
Artist
YouTube Video ID
YouTube URL
Language
Category
Channel
Sort Order
Enabled
```

Optional:

```text
Album
Year
Description
Rights Notes
```

---

# 3. Supported Languages

Initial categories may include:

```text
Bhojpuri
Maithili
Hindi
Traditional/Folk
```

The catalog should remain flexible for future languages.

---

# 4. Content Categories

Examples:

```text
Chhathi Maiya
Surya Dev
Sandhya Arghya
Usha Arghya
Traditional
Folk
Devotional
Morning
Evening
```

A song may belong to multiple channels/categories.

---

# 5. Channel Curation

Example:

```text
ALL CHHATH
    ↓
Bhojpuri
Maithili
Traditional
Chhathi Maiya
Surya Dev
Sandhya Arghya
Usha Arghya
```

Do not require separate copies of a song for each channel.

Use relationships.

---

# 6. Song Ordering

Support:

```text
manual order
```

Optionally:

```text
shuffle
```

The default should be deterministic unless shuffle is explicitly enabled.

---

# 7. Enabled/Disabled

Every song should have:

```text
enabled = true/false
```

Disabled songs:

- remain in admin
- do not appear publicly
- do not enter radio queue

---

# 8. Broken Video Handling

If a YouTube video becomes:

- unavailable
- private
- embedding disabled
- removed

the admin should be able to disable it immediately.

---

# 9. Catalog Validation

Before saving a song:

Validate:

- URL format
- Video ID extraction
- required title
- channel/category
- duplicate video ID

Warn if the same YouTube video already exists.

---

# 10. Duplicate Prevention

The same YouTube Video ID should normally not exist as multiple independent songs.

If a song needs multiple channels, use channel relationships.

---

# 11. Admin UI

Song list should show:

```text
Title
Artist
Language
Channel
Enabled
Sort Order
YouTube ID
Created
```

Actions:

```text
Edit
Disable
Delete
Preview
```

---

# 12. Add Song UI

Suggested:

```text
YouTube URL
[ Validate ]

Title
Artist
Language
Category
Channel
Sort Order
Enabled

[ Save Song ]
```

Do not make the admin enter the raw Video ID separately if it can be safely extracted.

---

# 13. Preview

Admin may preview the selected YouTube video using the official embed.

Do not download or extract the media.

---

# 14. Catalog Import

Optional future feature:

CSV/JSON import.

If implemented:

- validate every row
- show errors
- do not partially corrupt the catalog
- provide import summary

Example:

```text
100 rows
94 valid
6 invalid

[ Import 94 valid rows ]
```

---

# 15. Content Quality

Prefer:

- clear audio
- appropriate Chhath lyrics
- stable YouTube videos
- embeddable videos
- culturally appropriate selections

Avoid:

- duplicates
- low-quality uploads
- irrelevant songs
- misleading titles

---

# 16. Rights / Attribution

The application should maintain internal `rights_notes` where appropriate.

Do not imply that the website owns music simply because it embeds a YouTube video.

Use neutral language such as:

> Music is played through official YouTube embeds.

---

# 17. Future Content

Potential future categories:

```text
Regional Chhath
Instrumental
Traditional Folk
Children's Chhath
Live/Acoustic
Morning Devotion
Evening Devotion
```

Do not build all of these into MVP unless content exists.

---

# 18. Content Principle

The value of CHHATH RADIO is not the number of songs.

It is the quality of the curation.

A smaller, excellent catalog is better than a huge noisy catalog.
