# Chhath Radio — Neumorphism Redesign Plan

## Overview

Complete redesign from glassmorphism → **neumorphism** with correct layout, responsive Tailwind CSS, and all functionality preserved.

---

## Design System: Neumorphism

Neumorphism uses **soft shadows** (light + dark) on a base background to create a "pushed in" or "extruded" effect. For a dark theme over the Chhath ghat background:

### Base Colors
```css
/* Dark neumorphic base — semi-transparent so ghat scene shows through */
--nm-bg:        rgba(15, 8, 4, 0.88)   /* dark warm brown */
--nm-shadow-dark:  rgba(0, 0, 0, 0.7)
--nm-shadow-light: rgba(60, 30, 10, 0.35)
--nm-accent:    #f97316   /* orange-500 */
--nm-accent-glow: rgba(249, 115, 22, 0.4)
```

### Neumorphic Shadow Patterns
```css
/* Raised (extruded) element */
box-shadow: 6px 6px 16px rgba(0,0,0,0.7), -3px -3px 10px rgba(60,30,10,0.3);

/* Pressed (inset) element */
box-shadow: inset 4px 4px 10px rgba(0,0,0,0.6), inset -2px -2px 6px rgba(60,30,10,0.25);

/* Active button */
box-shadow: inset 3px 3px 8px rgba(0,0,0,0.6), inset -1px -1px 4px rgba(60,30,10,0.2);

/* Pill/card */
box-shadow: 8px 8px 20px rgba(0,0,0,0.65), -4px -4px 12px rgba(60,30,10,0.28), inset 0 1px 0 rgba(255,255,255,0.04);
```

### Tailwind CSS Custom Properties (globals.css additions)
```css
@layer base {
  :root {
    --nm-bg: rgba(15, 8, 4, 0.88);
    --nm-raised: 6px 6px 16px rgba(0,0,0,0.7), -3px -3px 10px rgba(60,30,10,0.3);
    --nm-pressed: inset 4px 4px 10px rgba(0,0,0,0.6), inset -2px -2px 6px rgba(60,30,10,0.25);
    --nm-pill: 8px 8px 20px rgba(0,0,0,0.65), -4px -4px 12px rgba(60,30,10,0.28);
  }
}
```

---

## Layout Architecture

```
┌─────────────────────────────────────────────────────────┐
│  [ListenerCount]    [ChhathCountdown]    [LiveClock]    │  ← fixed top
│  top-left           top-center           top-right       │
├─────────────────────────────────────────────────────────┤
│                                                         │
│              3D Ghat Scene (background)                 │
│                                                         │
│  [Share]                                    [Chat FAB]  │
│  left-center                                right-center │
│                                                         │
│              [ChhathFacts ticker]                       │  ← above player
│                                                         │
│  [?]    [════════ RadioPlayer ════════]    [🪔 React]  │  ← player row
│  left                center                right        │
├─────────────────────────────────────────────────────────┤
│  छठ के गीत    Made with 🪔 for Chhathi Maiya    [Donate]│  ← fixed footer
└─────────────────────────────────────────────────────────┘
```

### Fixed Position Map (Tailwind classes)

| Element | Position | Classes |
|---------|----------|---------|
| ListenerCount | top-left | `fixed top-3 sm:top-4 left-3 sm:left-4 z-20` |
| ChhathCountdown | top-center | `fixed top-3 sm:top-4 left-1/2 -translate-x-1/2 z-20` |
| LiveClock | top-right | `fixed top-3 sm:top-4 right-3 sm:right-4 z-20` |
| ShareFloatingButton | left-center | `fixed left-0 top-1/2 -translate-y-1/2 z-30` |
| LiveChatDrawer FAB | right-center | `fixed right-3 sm:right-4 bottom-24 sm:bottom-28 z-45` |
| ChhathFacts | above player | `fixed bottom-28 sm:bottom-32 left-0 right-0 z-20` |
| KeyboardHelp "?" | player-left | `fixed bottom-14 sm:bottom-16 left-3 sm:left-4 z-25` |
| RadioPlayer | center-bottom | `fixed bottom-12 sm:bottom-14 left-0 right-0 z-20` |
| ReactionBar FAB | player-right | `fixed bottom-14 sm:bottom-16 right-3 sm:right-4 z-20` |
| Footer | bottom | `fixed bottom-0 left-0 right-0 z-20 h-11 sm:h-12` |
| TuneInSplash | full-screen | `fixed inset-0 z-[100]` |

**Key insight**: Footer is `h-11` (44px). Player sits at `bottom-12` (48px) — just above footer. Facts at `bottom-28` (112px). ReactionFAB and HelpButton at `bottom-14` (56px) — same level as player center.

---

## Component Redesign Specs

### globals.css — Add neumorphism CSS variables + animations

```css
/* Neumorphic shadow utilities */
.nm-raised {
  box-shadow: 6px 6px 16px rgba(0,0,0,0.7), -3px -3px 10px rgba(60,30,10,0.3),
              inset 0 1px 0 rgba(255,255,255,0.04);
}
.nm-pressed {
  box-shadow: inset 4px 4px 10px rgba(0,0,0,0.6), inset -2px -2px 6px rgba(60,30,10,0.25);
}
.nm-pill {
  box-shadow: 8px 8px 20px rgba(0,0,0,0.65), -4px -4px 12px rgba(60,30,10,0.28),
              inset 0 1px 0 rgba(255,255,255,0.04);
}
.nm-btn {
  box-shadow: 4px 4px 10px rgba(0,0,0,0.6), -2px -2px 6px rgba(60,30,10,0.25);
  transition: box-shadow 0.15s ease, transform 0.1s ease;
}
.nm-btn:hover {
  box-shadow: 5px 5px 14px rgba(0,0,0,0.65), -3px -3px 8px rgba(60,30,10,0.28);
}
.nm-btn:active {
  box-shadow: inset 3px 3px 8px rgba(0,0,0,0.6), inset -1px -1px 4px rgba(60,30,10,0.2);
  transform: scale(0.97);
}
```

### 1. PageClient.tsx — Layout orchestrator

**Changes:**
- All HUD elements use `fixed` positioning (already done)
- Correct z-index layering
- Footer `h-11 sm:h-12`
- Player at `bottom-12 sm:bottom-14` (above footer)
- Facts at `bottom-28 sm:bottom-32`
- ReactionFAB + HelpButton at `bottom-14 sm:bottom-16`
- LiveChatDrawer FAB at `bottom-24 sm:bottom-28` (above ReactionFAB)

### 2. TuneInSplash.tsx — Full-screen opaque overlay

**Problem**: Currently semi-transparent, not covering canvas properly.

**Fix**: Use `fixed inset-0 z-[100]` with solid dark background + neumorphic button.

```tsx
<div className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-8
                cursor-pointer select-none transition-opacity duration-300"
     style={{ 
       background: "rgba(8, 3, 1, 0.95)",  // near-opaque dark
       opacity: fading ? 0 : 1 
     }}>
  
  {/* Neumorphic card */}
  <div className="flex flex-col items-center gap-6 p-8 sm:p-10 rounded-3xl"
       style={{ 
         background: "rgba(15, 8, 4, 0.9)",
         boxShadow: "12px 12px 32px rgba(0,0,0,0.8), -6px -6px 20px rgba(60,30,10,0.3), inset 0 1px 0 rgba(255,255,255,0.04)"
       }}>
    
    <div className="diya-pulse text-7xl sm:text-8xl">🪔</div>
    
    <div className="text-center">
      <h1 className="text-3xl sm:text-4xl font-extrabold text-white tracking-wide">Chhath Radio</h1>
      <p className="text-orange-500/80 mt-2 font-semibold">छठ के गीत, बिना रुके</p>
    </div>
    
    {/* Neumorphic button */}
    <button className="nm-btn px-10 py-3.5 rounded-full bg-gradient-to-br from-orange-400 to-orange-600
                       text-white text-lg font-bold tracking-wide">
      🎵 Tune In
    </button>
    
    <p className="text-white/25 text-xs tracking-widest">Click anywhere to start</p>
  </div>
</div>
```

### 3. RadioPlayer.tsx — Neumorphic pill

**Changes:**
- Replace glassmorphic `backdrop-blur` with neumorphic shadows
- Background: `rgba(15, 8, 4, 0.92)` with `nm-pill` shadow
- Buttons: `nm-btn` class for raised effect, `nm-pressed` on active
- Progress bar: inset neumorphic track

```tsx
{/* Neumorphic pill */}
<div className="flex flex-col rounded-3xl overflow-hidden w-full max-w-2xl"
     style={{
       background: "rgba(15, 8, 4, 0.92)",
       boxShadow: "8px 8px 24px rgba(0,0,0,0.7), -4px -4px 14px rgba(60,30,10,0.28), inset 0 1px 0 rgba(255,255,255,0.04)"
     }}>
```

### 4. ChhathCountdown.tsx — Neumorphic card

```tsx
<div className="flex flex-col items-center gap-2 text-center select-none
                min-w-[160px] rounded-2xl px-4 py-2.5"
     style={{
       background: "rgba(15, 8, 4, 0.88)",
       boxShadow: "6px 6px 16px rgba(0,0,0,0.7), -3px -3px 10px rgba(60,30,10,0.3), inset 0 1px 0 rgba(255,255,255,0.03)"
     }}>
```

### 5. LiveClock.tsx — Neumorphic card

```tsx
<div className="text-center tabular-nums select-none rounded-2xl px-3.5 py-2 sm:px-4 sm:py-2.5"
     style={{
       background: "rgba(15, 8, 4, 0.88)",
       boxShadow: "6px 6px 16px rgba(0,0,0,0.7), -3px -3px 10px rgba(60,30,10,0.3)"
     }}>
```

### 6. ListenerCount.tsx — Neumorphic pill

```tsx
<div className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1"
     style={{
       background: "rgba(15, 8, 4, 0.88)",
       boxShadow: "4px 4px 12px rgba(0,0,0,0.65), -2px -2px 8px rgba(60,30,10,0.28)"
     }}>
```

### 7. ReactionBar.tsx — Neumorphic FAB

```tsx
<button className="relative z-[2] w-12 h-12 rounded-full flex items-center justify-center text-[22px] cursor-pointer"
        style={{
          background: expanded ? "linear-gradient(135deg, #fb923c, #ea580c)" : "rgba(15, 8, 4, 0.92)",
          boxShadow: expanded
            ? "inset 3px 3px 8px rgba(0,0,0,0.5), 0 0 20px rgba(249,115,22,0.5)"
            : "5px 5px 14px rgba(0,0,0,0.7), -3px -3px 8px rgba(60,30,10,0.3)"
        }}>
```

### 8. KeyboardHelpButton.tsx — Neumorphic "?" button

```tsx
<button className="w-7 h-7 rounded-full flex items-center justify-center text-[13px] font-bold cursor-pointer"
        style={{
          background: "rgba(15, 8, 4, 0.88)",
          boxShadow: open
            ? "inset 3px 3px 8px rgba(0,0,0,0.6), inset -1px -1px 4px rgba(60,30,10,0.2)"
            : "4px 4px 10px rgba(0,0,0,0.65), -2px -2px 6px rgba(60,30,10,0.25)",
          color: open ? "#fb923c" : "rgba(255,255,255,0.45)"
        }}>
```

### 9. ShareFloatingButton.tsx — Neumorphic tab

```tsx
<button className="flex flex-col items-center justify-center gap-1.5 rounded-r-xl px-2.5 py-4 sm:py-5
                   text-white cursor-pointer select-none"
        style={{
          background: "linear-gradient(180deg, #fb923c, #ea580c)",
          boxShadow: "6px 6px 20px rgba(0,0,0,0.7), -2px -2px 8px rgba(60,30,10,0.3), inset -1px 0 0 rgba(255,255,255,0.15)",
          transform: "perspective(600px) rotateY(4deg)"
        }}>
```

### 10. LiveChatDrawer.tsx — Neumorphic drawer

```tsx
{/* FAB */}
<button className="fixed bottom-24 sm:bottom-28 right-3 sm:right-4 z-[45]
                   w-12 h-12 rounded-full flex items-center justify-center text-xl cursor-pointer"
        style={{
          background: isOpen ? "linear-gradient(135deg, #fb923c, #ea580c)" : "rgba(15, 8, 4, 0.92)",
          boxShadow: "5px 5px 14px rgba(0,0,0,0.7), -3px -3px 8px rgba(60,30,10,0.3)"
        }}>

{/* Drawer */}
<div className="fixed right-3 sm:right-4 z-[44] flex flex-col rounded-[20px] overflow-hidden"
     style={{
       bottom: "calc(6rem + 3.5rem + 0.75rem)",
       width: "min(92vw, 340px)",
       height: "min(70vh, 520px)",
       background: "rgba(12, 5, 2, 0.97)",
       boxShadow: "12px 12px 32px rgba(0,0,0,0.8), -6px -6px 20px rgba(60,30,10,0.3)"
     }}>
```

### 11. ChhathFacts.tsx — Transparent (no background needed)

Keep as-is — gradient text on transparent background looks great over the scene.

### 12. Footer — Neumorphic bar

```tsx
<div className="fixed bottom-0 left-0 right-0 z-20 h-11 sm:h-12"
     style={{
       background: "rgba(10, 4, 2, 0.95)",
       boxShadow: "0 -4px 16px rgba(0,0,0,0.6), 0 -1px 0 rgba(249,115,22,0.15)"
     }}>
```

---

## Implementation Order

1. **[`globals.css`](frontend/app/globals.css)** — Add neumorphic CSS utility classes + animations
2. **[`PageClient.tsx`](frontend/components/radio/PageClient.tsx)** — Fix all positions (fixed, correct bottom values)
3. **[`TuneInSplash.tsx`](frontend/components/radio/TuneInSplash.tsx)** — Full opaque overlay + neumorphic card
4. **[`RadioPlayer.tsx`](frontend/components/radio/RadioPlayer.tsx)** — Neumorphic pill
5. **[`ChhathCountdown.tsx`](frontend/components/radio/ChhathCountdown.tsx)** — Neumorphic card
6. **[`LiveClock.tsx`](frontend/components/radio/LiveClock.tsx)** — Neumorphic card
7. **[`ListenerCount.tsx`](frontend/components/radio/ListenerCount.tsx)** — Neumorphic pill
8. **[`ReactionBar.tsx`](frontend/components/radio/ReactionBar.tsx)** — Neumorphic FAB
9. **[`KeyboardHelpButton.tsx`](frontend/components/radio/KeyboardHelpButton.tsx)** — Neumorphic button
10. **[`ShareFloatingButton.tsx`](frontend/components/radio/ShareFloatingButton.tsx)** — Neumorphic tab
11. **[`LiveChatDrawer.tsx`](frontend/components/radio/LiveChatDrawer.tsx)** — Neumorphic drawer
12. **Browser verify** at 375px, 768px, 1280px — iterate until correct

---

## Key Rules

1. **No hardcoded pixel values in className** — use Tailwind spacing scale
2. **Neumorphic shadows via inline `style`** — complex box-shadows can't be Tailwind classes
3. **All positioning via `fixed`** — not `absolute` (avoids parent stacking context issues)
4. **Tailwind v4** — `@import "tailwindcss"` in globals.css, all standard classes work
5. **Preserve all functionality** — SSE, reactions, chat, keyboard shortcuts, etc.
6. **Responsive** — `sm:` breakpoint for tablet/desktop variants
7. **TuneInSplash** — must be `opacity: 0.95+` to cover the 3D scene completely