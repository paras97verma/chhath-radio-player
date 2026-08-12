# CHHATH RADIO — Visual Style Guide

## 1. Brand Essence

**Brand:** CHHATH RADIO  
**Hindi:** छठ रेडियो  
**Primary tagline:** छठ के गीत, बिना रुके।  
**English supporting line:** Non-stop Chhath Geet

### Brand personality

CHHATH RADIO should feel:

- Spiritual
- Warm
- Peaceful
- Cinematic
- Premium
- Minimal
- Indian
- Nostalgic
- Contemporary
- Atmospheric

It should feel like a **digital Chhath ghat**, not a generic music website.

### Emotional target

When a visitor opens the site, the immediate emotional impression should be:

> "I feel like I am standing beside a river during Chhath."

---

# 2. Core Visual Metaphor

The entire visual language is based on five elements:

1. ☀️ Sun
2. 🌊 River
3. 🪔 Diya
4. 🛕 Ghat
5. 🌫️ Atmosphere

These elements should be represented in a **minimalist, stylized 3D language**.

Do not attempt photorealistic festival scenes.

Do not create large crowds or overly detailed religious imagery.

Prefer:

- silhouettes
- simple geometry
- soft lighting
- negative space
- subtle motion
- atmospheric depth

---

# 3. Design Principle

## "Less UI, more atmosphere."

The interface should disappear into the environment.

The user should primarily notice:

1. Chhath atmosphere
2. Current song
3. YouTube player
4. Play action

Everything else is secondary.

---

# 4. Color System

## Core Colors

| Name | Hex | Purpose |
|---|---|---|
| Night Sky | `#0B1220` | Night background |
| Deep River | `#123B52` | River / dark environment |
| River Blue | `#245B73` | Daytime river |
| Sun Gold | `#E9B949` | Primary gold |
| Sun Orange | `#F4A62A` | Sun / highlights |
| Deep Orange | `#D96B27` | Sunset |
| Sand | `#F5D7A1` | Warm surfaces |
| Diya Gold | `#FFD76A` | Diya glow |
| Warm White | `#FFF8E8` | Primary text |
| Muted White | `#D9D4C8` | Secondary text |

## Color usage rule

Never use the entire palette simultaneously.

Colors should be driven by time of day.

---

# 5. Time-of-Day Color Themes

## Dawn / Usha Arghya

Mood:

Quiet, sacred, hopeful.

Palette direction:

- deep navy
- muted blue
- violet-blue
- soft orange
- warm gold

The horizon should gradually transition from dark blue to warm orange.

---

## Morning

Mood:

Fresh and peaceful.

Palette:

- warm sky
- golden sunlight
- blue river
- warm sand

Use brighter but still soft colors.

---

## Afternoon

Mood:

Clear and energetic.

Palette:

- brighter blue
- warm gold
- light sand
- subtle orange

Reduce fog and glow.

---

## Sunset / Sandhya Arghya

This is the signature visual state.

Mood:

Emotional, sacred, warm.

Palette:

- deep orange
- amber
- gold
- warm red-orange
- dark river blue

The sun should dominate the horizon.

Use long warm reflections on the river.

---

## Night

Mood:

Quiet, devotional, intimate.

Palette:

- deep navy
- almost-black blue
- muted blue
- diya gold
- moon white

The river should become darker while diyas become the primary warm light.

---

# 6. Typography

## English

Preferred:

1. Inter
2. Manrope
3. DM Sans

Use one primary font only.

Avoid mixing many fonts.

## Hindi

Use:

**Noto Sans Devanagari**

The Hindi type should feel clean and contemporary.

---

# 7. Typography Scale

## Desktop

Hero brand:

56–80px

Primary heading:

36–48px

Section heading:

24–32px

Song title:

20–28px

Body:

15–17px

Metadata:

12–14px

Micro-label:

10–12px

## Mobile

Hero brand:

36–48px

Primary heading:

28–36px

Song title:

18–22px

Body:

14–16px

Metadata:

11–13px

---

# 8. Typography Rules

Use large typography sparingly.

Prefer:

> CHHATH RADIO

rather than:

> Welcome to the official Chhath Radio music streaming experience.

Use short labels:

- NOW PLAYING
- UP NEXT
- GHAT MODE
- CHHATH RADIO
- SANDHYA ARGHYA
- USHA ARGHYA

Avoid paragraphs on the primary hero.

---

# 9. Logo

## Logo concept

Minimal combination of:

- rising sun
- river
- tiny diya

The logo should work in:

- light
- dark
- monochrome
- favicon
- mobile app icon

Avoid detailed illustrations.

---

# 10. 3D Art Direction

The 3D world is the heart of the visual identity.

Technology:

- Three.js
- React Three Fiber
- Drei

## Style

Use:

- low-poly geometry
- soft gradients
- soft shadows
- atmospheric fog
- subtle bloom
- restrained reflections
- large negative spaces

Avoid:

- photorealism
- hyper-detailed models
- game-like environments
- excessive particles
- neon lighting
- realistic human crowds

---

# 11. River

The river should be a major visual anchor.

Use:

- broad horizontal plane
- subtle procedural waves
- low-amplitude movement
- soft reflections

The river should never distract from the player.

The movement should be slow.

---

# 12. Sun

The sun should be simple.

Recommended:

- emissive sphere/disc
- soft halo
- subtle bloom
- horizon positioning

The sun should change position based on time of day.

---

# 13. Ghat

Use simple geometric steps.

Suggested structure:

- 3–7 large stepped layers
- subtle silhouette
- warm edge lighting
- minimal decorative detail

The ghat should communicate "riverbank" without becoming a detailed architectural model.

---

# 14. Diyas

Use a small number of glowing diyas.

Diyas should:

- float subtly
- emit warm light
- create soft reflections
- move slowly

Do not fill the screen with hundreds of diyas.

Recommended:

Desktop:

5–15 visible.

Mobile:

3–8 visible.

---

# 15. Fog and Atmosphere

Fog should create depth.

Use:

- low density
- smooth transitions
- time-of-day dependent intensity

Higher during:

- dawn
- sunset

Lower during:

- afternoon

Moderate during:

- night

---

# 16. Motion Language

Motion should be:

- slow
- smooth
- organic
- purposeful

Nothing should bounce unnecessarily.

Avoid:

- aggressive easing
- fast zooms
- spinning 3D objects
- constant camera movement
- excessive particle animation

---

# 17. Camera

Default camera:

- slightly elevated
- facing the river
- ghat in middle/far distance
- sun positioned naturally

Use extremely subtle camera parallax.

Mouse movement should produce only a small camera shift.

Never make users feel like they are inside a game.

---

# 18. UI Surfaces

UI surfaces should visually integrate with the scene.

Preferred:

- translucent dark surfaces
- subtle blur
- thin borders
- very low opacity
- soft shadows

Avoid large opaque cards.

Example:

```text
rgba(11,18,32,0.45)
```

Use backdrop blur carefully.

---

# 19. Buttons

Primary button:

**PLAY RADIO**

Shape:

- rounded
- compact
- premium

Do not make it enormous.

Suggested:

desktop width: 160–200px

mobile width: 140–180px

Use warm gold/orange as the active accent.

---

# 20. YouTube Player

The YouTube player must remain a genuine visible YouTube embed.

Do not:

- cover it
- hide its controls
- place overlays over it
- create a fake player
- extract its audio

The surrounding UI should visually frame the player.

Recommended:

- subtle rounded corners
- restrained shadow
- clean spacing
- 16:9 ratio

---

# 21. Now Playing

The Now Playing area should be visually quiet.

Example:

```text
NOW PLAYING

काँच ही बाँस के बहंगिया

Traditional · Bhojpuri
```

Use a small uppercase label and a larger song title.

---

# 22. Up Next

Show 3–5 items maximum.

Avoid a long playlist on the main screen.

Example:

```text
UP NEXT

01  Uga Ho Suraj Dev
02  Hey Chhathi Maiya
03  Kelwa Ke Paat Par
```

---

# 23. Navigation

Navigation should be minimal.

Desktop:

```text
CHHATH RADIO

Radio
Ghat Mode
Chhath
About
```

Mobile:

Use a minimal menu.

Do not create a large navigation bar.

---

# 24. Icons

Use one consistent icon system.

Recommended:

Lucide Icons.

Icons should be:

- thin
- simple
- rounded

Do not use emoji as primary UI icons.

Emoji can appear in cultural/social content.

---

# 25. Shadows

Use soft shadows.

Avoid harsh black shadows.

Example:

```text
0 12px 40px rgba(0,0,0,0.20)
```

Use shadows to separate UI from the environment, not to create card-heavy designs.

---

# 26. Borders

Use very subtle borders.

Preferred:

```text
1px solid rgba(255,255,255,0.10)
```

Avoid thick borders.

---

# 27. Border Radius

Preferred:

Buttons:

999px

Player:

16–20px

Panels:

16–24px

Small elements:

10–14px

Avoid excessive rounded-card styling.

---

# 28. Responsive Philosophy

Desktop:

Immersive cinematic scene.

Mobile:

Same atmosphere, simplified 3D complexity.

Tablet:

Balanced composition.

TV:

Ghat Mode.

---

# 29. Mobile 3D Quality

Automatically reduce:

- particle count
- shadow quality
- texture resolution
- bloom
- reflection complexity

on low-end devices.

The website must remain usable even when 3D quality is reduced.

---

# 30. Accessibility

Always support:

- keyboard navigation
- visible focus
- semantic HTML
- ARIA labels
- sufficient contrast
- reduced motion

If:

`prefers-reduced-motion: reduce`

then:

- stop camera movement
- reduce particles
- disable nonessential animations
- reduce water movement

---

# 31. Loading State

Never show a generic spinner in the center of the screen.

Instead:

```text
☀

CHHATH RADIO

Preparing the ghat...
```

Use a subtle sun/river animation.

---

# 32. Error State

Keep errors calm.

Example:

```text
Playback unavailable.

Trying the next song...
```

Do not show technical stack traces to users.

---

# 33. Empty State

If there are no songs:

```text
CHHATH RADIO

No songs are available right now.

Please check back soon.
```

---

# 34. Visual Hierarchy

Priority order:

1. Chhath atmosphere
2. Brand
3. YouTube player
4. Play action
5. Current song
6. Next songs
7. Secondary controls
8. Navigation
9. Informational content

---

# 35. Design Anti-Patterns

Never introduce:

- generic SaaS dashboards
- excessive white cards
- purple gradients
- glassmorphism everywhere
- neon cyberpunk effects
- excessive animations
- giant menus
- stock festival photography as the primary identity
- game-like 3D environments
- cartoonish religious imagery
- excessive religious iconography
- visual clutter

---

# 36. Final Visual Test

Ask:

> Does this look like a premium digital Chhath ghat?

If yes, continue.

If it looks like:

- a music SaaS
- a gaming website
- a YouTube clone
- a festival template

then simplify it.

---

# 37. Design North Star

**CHHATH RADIO should feel like listening to Chhath songs beside a quiet river at sunset.**

Minimal UI.

Maximum atmosphere.

