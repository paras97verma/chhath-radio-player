# CHHATH RADIO — Design Language & Creative Direction

## 1. Design Language Statement

CHHATH RADIO is a **minimalist interactive 3D cultural experience built around curated YouTube Chhath music**.

The design language combines:

**Indian cultural atmosphere + cinematic environmental design + minimalist UI + lightweight 3D interaction.**

The goal is not to reproduce a physical Chhath ghat literally.

The goal is to evoke the feeling of being there.

---

# 2. The Core Idea

## "A digital ghat for Chhath music."

The website should feel like a place.

Not a page.

Not a dashboard.

Not a YouTube clone.

Not a conventional radio player.

When the user arrives, they should immediately enter a calm digital environment containing:

- a river
- a sun/moon
- a distant ghat
- diyas
- atmospheric light
- Chhath music

The UI exists inside this world.

---

# 3. Experience Formula

The experience should follow:

```text
ATMOSPHERE
    +
MUSIC
    +
TIME
    +
CULTURE
    +
MINIMAL INTERACTION
```

These five elements define the product.

---

# 4. Cultural Language

Represent Chhath through visual symbols rather than excessive literal decoration.

Primary motifs:

### Sun

Represents Surya Dev.

### River

Represents the ghat environment and ritual setting.

### Diya

Represents devotion and warmth.

### Ghat

Represents the physical place where the ritual happens.

### Soop-inspired geometry

Use extremely subtle geometric references.

Do not create large literal props everywhere.

---

# 5. Visual Abstraction

Use abstraction instead of literal realism.

For example:

Instead of:

"A detailed 3D woman holding a soop."

Use:

"Warm silhouette + subtle geometric form + river + sun."

Instead of:

"A detailed realistic ghat."

Use:

"Minimal stepped geometry."

Instead of:

"A huge festival crowd."

Use:

"Distant silhouettes."

This keeps the experience timeless and premium.

---

# 6. Spatial Composition

The scene should generally follow three visual layers.

## Foreground

Minimal UI and subtle diyas.

## Midground

River.

## Background

Ghat, horizon, sun/moon.

This creates depth without complexity.

---

# 7. The Horizon

The horizon is extremely important.

Keep it relatively clean.

The sun should have enough empty space around it.

Do not place UI directly across the sun.

The horizon should provide the strongest sense of scale.

---

# 8. Negative Space

Negative space is a major design element.

Do not fill the screen.

Large empty areas allow:

- sun
- river
- typography
- player

to breathe.

The empty space should feel intentional.

---

# 9. Camera Language

The camera should feel like a person standing quietly beside a river.

Never like:

- a drone flying around
- a video game camera
- a rotating product showcase

Use:

- slow parallax
- subtle depth
- small camera offsets

Default camera movement should be barely noticeable.

---

# 10. Interaction Philosophy

Every interaction should feel calm.

Examples:

### Hover

A button gently brightens.

### Click

Small scale transition.

### Song change

Soft title fade.

### Channel change

Environment slightly shifts.

### Ghat Mode

UI gradually fades.

Avoid dramatic transitions.

---

# 11. Time Is a Design System

Time of day is not merely a background feature.

It controls:

- sky
- sun
- moon
- river
- fog
- diya brightness
- environment color
- typography contrast
- featured festival state

Create a centralized:

`TimeOfDayEngine`

All components should consume its state.

---

# 12. Time-of-Day State Model

Recommended states:

```text
DAWN
MORNING
AFTERNOON
SUNSET
EVENING
NIGHT
```

Each state should define:

```text
skyColor
horizonColor
sunPosition
sunIntensity
riverColor
riverBrightness
fogDensity
diyaIntensity
ambientLight
environmentMood
festivalLabel
```

---

# 13. Transition Model

Never abruptly switch state.

Use interpolation.

Example:

```text
MORNING
   ↓
MORNING → SUNSET
   ↓
SUNSET
```

Transitions should take several minutes visually if possible, or at least animate smoothly when the state changes.

---

# 14. Festival Mode

Time-of-day and festival state are separate systems.

For example:

```text
Time:
SUNSET

Festival:
SANDHYA_ARGHYA
```

Together they create the final environment.

This allows the site to behave correctly outside the festival period while still feeling Chhath-inspired.

---

# 15. Festival States

```text
NAHAI_KHAI
KHARNA
SANDHYA_ARGHYA
USHA_ARGHYA
```

Each may influence:

- featured channel
- label
- greeting
- subtle environment parameters

Avoid turning the entire interface into a festival poster.

---

# 16. Audio Experience Language

The music is the emotional engine.

The website should not compete with the music.

Therefore:

- minimal animation
- minimal UI
- no constant notifications
- no distracting popups
- no unnecessary sound effects

The environment should support the music.

---

# 17. Song Change Language

When a new song begins:

1. update title
2. update artist
3. update category
4. gently brighten the scene
5. create a subtle river ripple
6. fade the metadata into place

Duration:

approximately 500–1200ms.

Do not use dramatic transitions.

---

# 18. Channel Language

Channels should feel like moods, not technical playlists.

Examples:

### Morning Chhath

Fresh and golden.

### Sandhya Arghya

Orange and warm.

### Chhathi Maiya

Deep devotional.

### Surya Dev

Bright and golden.

### Traditional

Earthy and nostalgic.

### Maithili

Soft and folk-oriented.

### Bhojpuri

Warm and energetic while remaining devotional.

The visual system should not radically change for each channel.

Only subtle mood adjustments.

---

# 19. Ghat Mode Language

Ghat Mode is the purest version of the product.

Remove:

- navigation
- unnecessary information
- large text
- secondary controls

Keep:

- 3D scene
- YouTube player
- song title
- minimal essential controls
- exit

The result should feel appropriate for displaying on a television.

---

# 20. Television Experience

For large screens:

- increase negative space
- increase typography
- reduce small controls
- emphasize the horizon
- increase river depth
- reduce UI density

The visual should work from several meters away.

---

# 21. Mobile Experience

Mobile is not simply desktop compressed.

Prioritize:

1. player
2. song
3. atmosphere
4. play
5. next song

Reduce:

- 3D complexity
- navigation
- secondary information

Keep the sun/river relationship visible.

---

# 22. YouTube Integration Language

The YouTube player is a functional object inside the environment.

It must remain an authentic embedded YouTube player.

Do not visually fake YouTube controls.

Do not cover the player.

Do not build an overlay pretending to be the player.

The visual design should frame and complement it.

---

# 23. UI Material Language

Preferred material:

**smoked glass / translucent dark surface**

Characteristics:

- low opacity
- subtle blur
- thin border
- soft shadow

But use this sparingly.

The website should not become a "glassmorphism" design.

---

# 24. Surface Hierarchy

Three surface levels:

### Level 0

3D environment.

### Level 1

Transparent UI.

### Level 2

Focused controls/player.

There should be very few Level 2 elements.

---

# 25. Motion Hierarchy

Three speeds:

### Ambient

Very slow.

Examples:

- water
- fog
- diya movement

### Interface

Medium.

Examples:

- buttons
- song title
- menus

### State transitions

Slow and smooth.

Examples:

- sunset
- festival mode
- Ghat Mode

Never use fast motion for ambient elements.

---

# 26. Lighting Language

Lighting is more important than texture.

Prioritize:

- sun direction
- ambient light
- river reflection
- diya glow
- atmospheric depth

Use fewer textures and better lighting.

---

# 27. Shadows

Soft shadows only.

The environment should feel dreamy.

Avoid hard game-engine shadows.

---

# 28. Materials

Prefer:

- matte
- semi-matte
- slightly emissive
- simple physically based materials

Avoid:

- chrome
- metallic gold everywhere
- glossy plastic
- highly reflective objects

The river can have controlled reflections.

---

# 29. 3D Performance Language

The 3D scene must always be subordinate to usability.

If performance drops:

1. reduce particles
2. reduce shadow quality
3. reduce reflection complexity
4. reduce post-processing
5. reduce geometry

Never sacrifice player usability for visual effects.

---

# 30. Device Quality Levels

Implement:

```text
HIGH
MEDIUM
LOW
```

### HIGH

Desktop GPU.

- full atmosphere
- shadows
- reflections
- particles
- bloom

### MEDIUM

Normal laptop/mobile.

- reduced particles
- simplified reflections
- reduced shadows

### LOW

Low-end mobile.

- simple river
- simple sun
- no heavy post-processing
- minimal particles

---

# 31. Accessibility Language

The experience must remain understandable without 3D.

Provide:

- semantic HTML
- readable text
- keyboard controls
- accessible player labels
- reduced motion
- visible focus
- sufficient contrast

If reduced motion is enabled:

- disable camera parallax
- reduce river movement
- reduce floating diyas
- remove nonessential transitions

---

# 32. Content Language

Primary language:

Hindi + English.

Keep UI language concise.

Examples:

```text
NOW PLAYING
अभी बज रहा है

UP NEXT
अगला गीत

PLAY RADIO
रेडियो चलाएँ

GHAT MODE
घाट मोड

SANDHYA ARGHYA
संध्या अर्घ्य

USHA ARGHYA
उषा अर्घ्य
```

Avoid long bilingual labels everywhere.

---

# 33. Copywriting Style

Tone:

- respectful
- warm
- concise
- devotional without being excessive
- culturally authentic

Prefer:

> जय छठी मईया 🙏

over:

> Welcome to the ultimate revolutionary Chhath music streaming experience!

---

# 34. Homepage Copy

Recommended:

```text
CHHATH RADIO

छठ के गीत, बिना रुके।

[ PLAY RADIO ]
```

Secondary:

```text
अभी बज रहा है
```

Avoid large marketing copy.

---

# 35. Error Copy

Use human language.

Bad:

> Error 500: PLAYER_INITIALIZATION_FAILED

Good:

> Playback unavailable.  
> Trying the next song...

---

# 36. Loading Copy

Recommended:

> घाट तैयार हो रहा है...

or:

> Preparing the ghat...

Keep it subtle.

---

# 37. Empty Copy

Recommended:

> अभी कोई गीत उपलब्ध नहीं है।

Do not show technical database terminology.

---

# 38. Branding Rules

Always write:

**CHHATH RADIO**

not:

- ChhathRadio
- Chhath radio
- CHHATHRadio

Hindi:

**छठ रेडियो**

Primary tagline:

**छठ के गीत, बिना रुके।**

---

# 39. Iconography

Use one icon family.

Recommended:

**Lucide**

Icon characteristics:

- thin
- geometric
- rounded
- understated

Avoid mixing multiple icon libraries.

---

# 40. Photography

Photography should NOT be the primary visual identity.

If photographs are used:

- use them sparingly
- use them for informational pages
- apply subtle dark/golden treatment
- never let stock photography dominate the homepage

The homepage should be 3D.

---

# 41. Illustration

Illustrations should use:

- simple geometry
- flat/soft shading
- warm colors
- minimal detail

Do not use cartoon festival illustrations.

---

# 42. Sound Design

Do not add ambient sound by default.

The selected YouTube music is the audio experience.

If ambient sound is ever introduced:

- it must be optional
- very quiet
- independently controllable
- never interfere with the song

---

# 43. What the Design Must Never Become

Never allow the design to drift toward:

### SaaS

Lots of cards, metrics, buttons.

### Gaming

Complex 3D scenes and camera movement.

### E-commerce

Product grids and promotional banners.

### YouTube clone

Search results and dense thumbnails.

### Festival poster

Too much text, decoration and religious imagery.

### Generic AI website

Gradients, glowing blobs, template sections.

---

# 44. Reference Mental Models

Use these conceptual references:

**Digital art installation**

for the environment.

**Radio station**

for the listening behavior.

**YouTube**

for the embedded playback engine.

**Meditation app**

for calmness.

**Indian riverside ghat**

for cultural atmosphere.

Do not directly copy any specific product's visual design.

---

# 45. Design North Star

Every design decision should answer:

> "Does this make the visitor feel closer to a peaceful Chhath ghat?"

If yes:

Keep it.

If no:

Remove it.

---

# 46. Final Creative Direction

CHHATH RADIO should feel like:

> **You opened a quiet digital window onto a Chhath ghat.**

You see the sun.

You see the river.

You see a few diyas.

You hear Chhath songs.

You know what is playing.

Everything else fades away.
