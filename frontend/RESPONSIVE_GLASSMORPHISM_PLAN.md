# Responsive + Glassmorphism Refactor Plan

## Overview

Complete refactor of all frontend components to:
1. **No hardcoded pixel values** — all positioning via Tailwind utility classes
2. **Fully responsive** — mobile-first with `sm:`, `md:`, `lg:` breakpoints
3. **Glassmorphism throughout** — `backdrop-blur`, `bg-white/10`, `border-white/10`, `shadow-2xl`
4. **Tailwind-only** — replace all `style={{ ... }}` inline positioning with className

---

## Layout Architecture (PageClient.tsx)

### Current Problems
- `bottom-[210px]`, `bottom-[72px]` — arbitrary pixel values not in Tailwind safelist
- `style={{ position: "fixed", bottom: "88px", right: "16px" }}` — inline styles for FAB
- `style={{ position: "fixed", bottom: "160px", left: "16px" }}` — inline styles for help button
- Footer uses inline `style={{ background, borderTop, backdropFilter }}`
- Color constants `C` use raw rgba strings instead of Tailwind color classes

### Responsive Layout Strategy

```
Mobile (< 640px):
  - Footer: hidden or minimal (just center text)
  - Player: full-width, bottom-14 (above footer)
  - ReactionFAB: bottom-20 right-3 (above player)
  - HelpButton: bottom-20 left-3 (above player, left side)
  - Facts ticker: bottom-36 (above player)
  - HUD: top-3 (listener, countdown, clock — stacked on mobile)

Desktop (≥ 640px):
  - Footer: full bar, bottom-0
  - Player: max-w-2xl centered, bottom-14
  - ReactionFAB: bottom-20 right-4
  - HelpButton: bottom-20 left-4
  - Facts ticker: bottom-40
```

### Fixed Positions Using Tailwind CSS Variables

The key insight: use `bottom-14` (56px) for footer height, `bottom-20` (80px) for player bottom, `bottom-36` (144px) for elements above player. These are standard Tailwind scale values that ARE in the generated CSS.

**Standard Tailwind spacing scale used:**
- `bottom-0` = 0px (footer)
- `bottom-14` = 56px (player bottom — above footer)
- `bottom-20` = 80px (FAB/help — above player bottom edge)
- `bottom-36` = 144px (facts ticker — above player)
- `bottom-40` = 160px (facts ticker desktop)

---

## Component-by-Component Plan

### 1. PageClient.tsx

**Changes:**
```tsx
// Footer — replace inline style with Tailwind
<div className="absolute bottom-0 left-0 right-0 z-20 
                bg-black/90 border-t border-orange-500/20 
                backdrop-blur-xl">

// Player wrapper — use standard Tailwind bottom
<div className="absolute bottom-14 left-0 right-0 z-20 flex justify-center px-3 sm:px-4">

// Facts ticker — above player
<div className="absolute bottom-36 sm:bottom-40 left-0 right-0 z-20 
                flex justify-center px-4 pointer-events-none">

// ReactionFAB — fixed, right of player, above footer
<div className="fixed bottom-20 right-3 sm:right-4 z-20">

// KeyboardHelp — fixed, left of player, above footer  
<div className="fixed bottom-20 left-3 sm:left-4 z-[25]">

// Footer text — responsive visibility
<span className="text-xs shrink-0 hidden sm:block text-orange-400 font-bold">
```

**Color replacements (C constants → Tailwind):**
- `C.footerBg` → `bg-black/90`
- `C.footerBorder` → `border-orange-500/20`
- `C.accent` → `text-orange-500`
- `C.accentBright` → `text-orange-400`
- `C.accentMuted` → `text-orange-500/90`
- `C.accentFaint` → `text-orange-500/70`
- `C.accentBorder` → `border-orange-500/30`

---

### 2. TuneInSplash.tsx

**Current:** All inline `style={{ ... }}` — position, font sizes, colors, animations

**Changes:**
```tsx
// Container — replace all inline styles
<div className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-8
                bg-black/90 backdrop-blur-xl cursor-pointer select-none
                transition-opacity duration-300"
     style={{ opacity: fading ? 0 : 1 }}>  // keep only opacity (dynamic)

// Diya icon
<div className="text-7xl sm:text-8xl leading-none 
                drop-shadow-[0_0_32px_rgba(249,115,22,0.7)]
                animate-[diyaPulse_2.5s_ease-in-out_infinite]">

// Title
<h1 className="text-3xl sm:text-4xl font-extrabold text-white tracking-wide
               text-shadow-[0_2px_16px_rgba(249,115,22,0.4)]">

// Subtitle
<p className="text-base text-orange-500/75 mt-1.5 font-semibold tracking-wide
              font-[Noto_Sans_Devanagari,Mangal,sans-serif]">

// Button
<button className="flex items-center gap-2.5 px-10 py-3.5 rounded-full
                   bg-gradient-to-br from-orange-400 to-orange-600
                   text-white text-lg font-bold tracking-wide
                   shadow-[0_0_32px_rgba(249,115,22,0.5),0_4px_16px_rgba(0,0,0,0.4)]
                   hover:scale-105 hover:shadow-[0_0_48px_rgba(249,115,22,0.7)]
                   transition-all duration-150">

// Hint text
<p className="text-xs text-white/25 tracking-widest">
```

---

### 3. ReactionBar.tsx

**Current:** All inline `style={{ ... }}` — button sizes, colors, animations, arc math

**Strategy:** Keep arc math (requires JS calculation) but replace static styles with Tailwind where possible. The FAB button and arc buttons use dynamic styles for animation — keep those as inline styles but use Tailwind for the container.

**Changes:**
```tsx
// Main FAB button — replace static inline styles with Tailwind
<button className="relative z-[2] w-12 h-12 rounded-full flex items-center justify-center
                   text-[22px] backdrop-blur-xl cursor-pointer
                   border border-orange-500/65 transition-all duration-200"
        style={{
          background: expanded ? "linear-gradient(135deg,#fb923c,#ea580c)" : "rgba(10,4,2,0.92)",
          // keep dynamic styles only
        }}>

// Arc emoji buttons — keep inline styles (arc math requires JS)
// But replace static parts with Tailwind
```

---

### 4. KeyboardHelpButton.tsx

**Current:** All inline `style={{ ... }}` — button size, colors, popover positioning

**Changes:**
```tsx
// Button
<button className="w-7 h-7 rounded-full flex items-center justify-center
                   text-[13px] font-bold cursor-pointer
                   backdrop-blur-lg transition-all duration-150
                   bg-white/7 border border-white/12 text-white/45
                   hover:bg-orange-500/12 hover:text-orange-500/80 hover:border-orange-500/30">

// Popover
<div className="absolute bottom-[calc(100%+10px)] right-0 w-60
                bg-black/97 border border-orange-500/22 rounded-2xl
                py-3 shadow-2xl backdrop-blur-2xl">
```

---

### 5. ShareFloatingButton.tsx

**Current:** Inline `style={{ position: "fixed", left: 0, top: "50%", ... }}`

**Changes:**
```tsx
// Container
<div className="fixed left-0 top-1/2 -translate-y-1/2 z-30 perspective-[600px]">

// Button — replace inline styles with Tailwind
<button className="flex flex-col items-center justify-center gap-1.5
                   rounded-r-xl px-2.5 py-4 sm:py-5
                   bg-gradient-to-b from-orange-400 via-orange-500 to-orange-600
                   text-white cursor-pointer select-none
                   shadow-[6px_6px_28px_rgba(249,115,22,0.75),3px_3px_0_#c2410c]
                   hover:[transform:perspective(600px)_rotateY(0deg)]
                   [transform:perspective(600px)_rotateY(4deg)]
                   transition-all duration-200">
```

---

### 6. LiveChatDrawer.tsx

**Current:** Large component with many inline styles for the drawer, FAB, messages

**Strategy:** Replace all static inline styles with Tailwind. Keep only dynamic styles (open/close animation, message timestamps).

**Key changes:**
```tsx
// FAB button
<button className="fixed bottom-20 right-4 z-30 w-12 h-12 rounded-full
                   flex items-center justify-center
                   bg-black/85 border border-orange-500/35
                   backdrop-blur-xl shadow-lg
                   hover:border-orange-500/65 transition-all">

// Drawer panel
<div className="fixed right-0 top-0 bottom-0 z-40 w-80 sm:w-96
                bg-black/90 border-l border-orange-500/15
                backdrop-blur-2xl flex flex-col
                transition-transform duration-300"
     style={{ transform: open ? 'translateX(0)' : 'translateX(100%)' }}>
```

---

### 7. ChhathCountdown.tsx

**Current:** Extensive inline styles for the card, day tabs, countdown digits

**Changes:**
```tsx
// Card container
<div className="bg-black/75 border border-orange-500/30 rounded-2xl
                backdrop-blur-xl shadow-2xl p-3 sm:p-4 min-w-[200px] sm:min-w-[240px]">

// Day tab buttons
<button className="px-2 py-0.5 rounded-full text-xs font-semibold
                   transition-all duration-150
                   data-[active=true]:bg-orange-500/20 data-[active=true]:text-orange-400
                   data-[active=false]:text-white/35 hover:text-white/60">

// Countdown digits
<div className="flex gap-2 sm:gap-3 items-end">
  <div className="flex flex-col items-center">
    <span className="text-2xl sm:text-3xl font-black text-white tabular-nums">
    <span className="text-[9px] text-orange-500/65 uppercase tracking-widest mt-0.5">
```

---

### 8. LiveClock.tsx

**Current:** Likely uses inline styles for the clock display

**Changes:**
```tsx
<div className="text-right">
  <div className="text-2xl sm:text-3xl font-black text-orange-400 tabular-nums tracking-tight">
  <div className="text-xs text-orange-500/60 mt-0.5 tracking-wide">
```

---

### 9. ListenerCount.tsx

**Current:** Uses inline styles for the pill container, spectrogram SVG

**Changes:**
```tsx
// Default pill
<div className="inline-flex items-center gap-1.5
                bg-black/52 border border-orange-500/22 rounded-full
                backdrop-blur-lg shadow-md px-2.5 py-1">

// Hot variant
<div className="inline-flex items-center gap-2 rounded-full
                bg-red-800/88 border border-red-500/45
                backdrop-blur-lg px-3 py-1 text-white font-semibold text-sm">
```

---

### 10. ChhathFacts.tsx

**Current:** Likely uses inline styles for the ticker

**Changes:**
```tsx
<div className="bg-black/60 border border-orange-500/20 rounded-full
                backdrop-blur-lg px-4 py-2 text-sm text-orange-400/90
                shadow-lg max-w-lg text-center">
```

---

## Glassmorphism Design System

All glassmorphic elements follow this pattern:

```
Background:   bg-black/75 to bg-black/90 (dark, semi-transparent)
Border:       border border-white/10 or border-orange-500/20
Blur:         backdrop-blur-xl (16px) or backdrop-blur-2xl (24px)
Shadow:       shadow-2xl or custom orange glow
Border radius: rounded-2xl (16px) or rounded-3xl (24px) or rounded-full
```

**Tailwind glassmorphism utility classes:**
```
bg-black/75 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl
bg-black/85 backdrop-blur-2xl border border-orange-500/20 rounded-3xl shadow-2xl
```

---

## Responsive Breakpoints

```
Mobile:  default (< 640px) — compact, stacked layout
Tablet:  sm: (≥ 640px)    — expanded, side-by-side
Desktop: md: (≥ 768px)    — full layout
Large:   lg: (≥ 1024px)   — max-width constraints
```

**Key responsive behaviors:**
- Footer: `hidden sm:flex` for left text
- Player: `max-w-xl sm:max-w-2xl` 
- Countdown: `text-xl sm:text-2xl` for digits
- Clock: `text-xl sm:text-3xl`
- FAB buttons: `w-10 h-10 sm:w-12 sm:h-12`
- Padding: `px-3 sm:px-4 md:px-6`

---

## Implementation Order

1. **[`PageClient.tsx`](frontend/components/radio/PageClient.tsx)** — layout foundation, all positioning
2. **[`TuneInSplash.tsx`](frontend/components/radio/TuneInSplash.tsx)** — first screen users see
3. **[`RadioPlayer.tsx`](frontend/components/radio/RadioPlayer.tsx)** — most complex, core UI
4. **[`ChhathCountdown.tsx`](frontend/components/radio/ChhathCountdown.tsx)** — top-center HUD
5. **[`LiveClock.tsx`](frontend/components/radio/LiveClock.tsx)** — top-right HUD
6. **[`ListenerCount.tsx`](frontend/components/radio/ListenerCount.tsx)** — top-left HUD
7. **[`ChhathFacts.tsx`](frontend/components/radio/ChhathFacts.tsx)** — facts ticker
8. **[`ReactionBar.tsx`](frontend/components/radio/ReactionBar.tsx)** — FAB
9. **[`KeyboardHelpButton.tsx`](frontend/components/radio/KeyboardHelpButton.tsx)** — help button
10. **[`ShareFloatingButton.tsx`](frontend/components/radio/ShareFloatingButton.tsx)** — share tab
11. **[`LiveChatDrawer.tsx`](frontend/components/radio/LiveChatDrawer.tsx)** — chat drawer
12. **[`ShareModal.tsx`](frontend/components/radio/ShareModal.tsx)** — share modal
13. **Browser verification** at 375px, 768px, 1280px

---

## Key Rules

1. **No `style={{ ... }}` for positioning** — use Tailwind `fixed`, `absolute`, `top-*`, `bottom-*`, `left-*`, `right-*`
2. **No hardcoded pixel values** — use Tailwind spacing scale (4=16px, 14=56px, 20=80px, etc.)
3. **Dynamic styles only** — `style={{ opacity: fading ? 0 : 1 }}` is OK (JS-driven)
4. **Animation keyframes** — keep in `<style>` tags (Tailwind can't do custom keyframes without config)
5. **Glassmorphism** — every card/pill/button uses `backdrop-blur-*` + `bg-black/*` + `border-white/*`
6. **Color via Tailwind** — `text-orange-400`, `bg-orange-500/20`, `border-orange-500/30` etc.