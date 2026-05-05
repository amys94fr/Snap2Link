# Snap2Link — Design System

Source of truth for both the desktop app and the marketing site
(`snap2link.app`). Anything visual that ships with the brand should
trace back to this document.

---

## 1 · Brand

**Name** — Snap2Link
**Tagline (long)** — "Paste screenshots into Claude Code, Cursor, or any terminal AI — in one keystroke."
**Tagline (short)** — "Screenshot → public link → clipboard. One keystroke."
**Logo** — Camera lens with link/chain motif on a slate gradient. Always include the wordmark "Snap2Link" alongside the icon when space allows.

**Voice & tone**

- Direct, technical, slightly playful — like talking to a senior engineer who wants the answer first, the explanation second.
- Verbs over nouns. *"Drag a region"* > *"Region selection"*.
- Show concrete tools by name when relevant: *Claude Code, Cursor, ChatGPT, Aider, Imgur, Drive*. Specifics build trust.
- No marketing fluff (*"revolutionary"*, *"seamless"*, *"AI-powered"* unless literal). The product is small and useful — the copy should match.
- Sentence case for headings, lowercase for code/CLI in body copy.

---

## 2 · Color tokens

All colors anchored on the existing Tailwind palette so the desktop app
and the website stay 1:1.

### Brand

| Token | Hex | Usage |
|---|---|---|
| `brand` | `#3B82F6` | Primary CTAs, hero accents, link colour, focus rings |
| `brand-dark` | `#2563EB` | Hover state for primary CTAs |
| `brand-glow` | `rgba(59, 130, 246, 0.40)` | Drop-shadow / radial glow behind hero, feature cards on hover |

### Neutrals (slate scale)

| Token | Hex | Usage |
|---|---|---|
| `slate-950` | `#0F172A` | Page background (dark mode default) |
| `slate-900` | `#1E293B` | Surface / card background, nav, footer |
| `slate-800` | `#334155` | Elevated cards, inactive button bg, dividers |
| `slate-700` | `#475569` | Borders, muted icons |
| `slate-400` | `#94A3B8` | Body subtitles, muted captions |
| `slate-300` | `#CBD5E1` | Body text on dark surfaces |
| `slate-100` | `#F1F5F9` | Headings on dark surfaces, near-white |
| `white`     | `#FFFFFF` | Inverse text on coloured fills, hero headline |

### Semantic

| Token | Hex | Usage |
|---|---|---|
| `success` | `#22C55E` | "Save & share" CTA, success badges, "Link copied" |
| `danger` | `#EF4444` | Errors, destructive buttons |
| `warning` | `#F59E0B` | "Not yet notarised" callouts |

### Accent (use sparingly)

| Token | Hex | Usage |
|---|---|---|
| `indigo-400` | `#818CF8` | AI / tech context tag pills, gradient mid-stops |
| `purple-500` | `#A855F7` | Annotator brand colour swatch |

### Gradients

- `bg-hero` — radial 60% from `brand-glow` to `slate-950`, centred top
- `bg-feature-glow` — linear 135° from `slate-900` to `slate-800`, with a `brand-glow` ring on hover
- `bg-cta` — solid `brand`, hover scales to `brand-dark`

### Contrast guarantees

- All body text ≥ AA on its surface (4.5:1)
- Brand-on-slate-950: 6.4:1 ✓
- Slate-300-on-slate-900: 8.1:1 ✓
- Slate-400-on-slate-950: 6.0:1 ✓ (use only for muted captions, never primary content)

---

## 3 · Typography

### Stacks

- **Display + body** — `Geist Sans` (self-hosted via Fontsource, weights 400/500/600/700)
- **Mono** — `Geist Mono` (weights 400/500, code samples + CLI snippets)

Fallback: `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`.

### Scale (8-step, 1.250 ratio)

| Token | Size | Line height | Letter spacing | Usage |
|---|---|---|---|---|
| `text-xs` | 12 / 0.75rem | 16 / 1rem | 0.025em | Badges, footnotes |
| `text-sm` | 14 / 0.875rem | 20 / 1.25rem | 0 | Captions, button labels |
| `text-base` | 16 / 1rem | 24 / 1.5rem | 0 | Body |
| `text-lg` | 18 / 1.125rem | 28 / 1.75rem | 0 | Lead paragraphs |
| `text-xl` | 20 / 1.25rem | 28 / 1.75rem | -0.01em | Card titles |
| `text-2xl` | 24 / 1.5rem | 32 / 2rem | -0.015em | Section subheads |
| `text-4xl` | 36 / 2.25rem | 40 / 2.5rem | -0.025em | Section titles |
| `text-6xl` | 60 / 3.75rem | 64 / 4rem | -0.035em | Hero headline |
| `text-7xl` | 72 / 4.5rem | 76 / 4.75rem | -0.04em | Hero headline (≥ lg breakpoint) |

### Weights

- Body: 400
- UI / button labels: 500
- Subheads / card titles: 600
- Display / hero / numerals: 700

### Pairings & rules

- **Hero headline** uses `text-6xl` mobile, `text-7xl` desktop, weight 700, tight tracking, white.
- **Body copy** is `text-lg` for marketing prose, `text-base` for dense lists.
- Never use weight 700 below `text-2xl` — it gets blocky.
- Keep paragraphs ≤ 70 characters wide (`max-w-prose` works).

---

## 4 · Spacing & layout

### Scale (4px base)

```
0=0  1=4  2=8  3=12  4=16  5=20  6=24  8=32  10=40  12=48
16=64  20=80  24=96  32=128  40=160  48=192  64=256
```

### Containers

- `max-w-7xl` (1280px) for hero, features, content sections
- `max-w-prose` (65ch) for long-form text
- Horizontal padding: 16px (`px-4`) mobile, 32px (`px-8`) tablet, 64px (`px-16`) desktop

### Section vertical rhythm

- `py-24` (96px) between major sections on desktop
- `py-16` (64px) on mobile
- Hero takes `min-h-screen` only on desktop; `min-h-[80vh]` on mobile to keep CTAs above the fold

### Breakpoints

```
sm  640
md  768
lg  1024
xl  1280
2xl 1536
```

Mobile-first. Design at 375 (iPhone SE) and 1280 (laptop) — everything else is interpolation.

### Grid

- Bento features: `grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4`
- Hero install buttons: `flex flex-col sm:flex-row gap-3` centred
- Footer: `grid-cols-2 md:grid-cols-4 gap-8`

---

## 5 · Border radius

| Token | Value | Usage |
|---|---|---|
| `rounded-md` | 6px | Buttons, badges |
| `rounded-lg` | 8px | Code blocks, small cards |
| `rounded-xl` | 12px | Feature cards, install buttons |
| `rounded-2xl` | 16px | Hero card, modal containers |
| `rounded-3xl` | 24px | Promotional banners |
| `rounded-full` | 9999px | Avatars, pill badges, icon buttons |

---

## 6 · Shadows

```css
/* Card resting on dark surface */
shadow-card: 0 1px 2px rgba(0,0,0,0.06), 0 1px 3px rgba(0,0,0,0.10);

/* Card raised on hover */
shadow-card-hover: 0 4px 6px rgba(0,0,0,0.08), 0 10px 20px rgba(0,0,0,0.20);

/* Modal / popover */
shadow-modal: 0 25px 50px -12px rgba(0,0,0,0.50);

/* Brand glow — hero, focused element halo */
shadow-glow: 0 0 32px rgba(59,130,246,0.45);
```

Avoid Tailwind's default `shadow-*` on dark backgrounds — the alpha-black
shadows disappear. Use the `shadow-glow` family instead.

---

## 7 · Motion

```css
--duration-fast:    150ms;   /* hover, focus */
--duration-base:    200ms;   /* most transitions */
--duration-slow:    400ms;   /* large layout shifts */
--duration-marquee: 30000ms; /* logo strip */

--ease-out-quart:   cubic-bezier(0.16, 1, 0.30, 1);   /* default, snappy */
--ease-in-out-cubic:cubic-bezier(0.65, 0.05, 0.36, 1);/* enter / exit pairs */
```

### Rules

- Hover: 150ms ease-out (instant feel)
- Card lift on hover: `translateY(-2px)` + `shadow-card-hover`, 200ms
- Page transitions: avoid them on a marketing site — they hurt perceived speed
- Always honour `prefers-reduced-motion: reduce` — disable parallax, marquee, autoplay GIF

---

## 8 · Components

### 8.1 · Buttons

| Variant | Bg | Text | Hover | Use |
|---|---|---|---|---|
| Primary | `brand` | `white` | `brand-dark` + `shadow-glow` | Single hero CTA |
| Success | `success` | `white` | `emerald-600` | "Save & share" annotator action |
| Secondary | `slate-800` | `slate-100` | `slate-700` | Anything-else |
| Ghost | transparent | `slate-300` | `slate-800` bg | Nav links |
| Outline | transparent | `slate-100` | `slate-100/10` bg | Hero secondary CTA |

**Sizes** — `sm` 32×8, `md` 40×16, `lg` 48×24 (height × horizontal padding in px). Touch target ≥ 44px on mobile (use `lg`).

**Icon buttons** — square, padding equals height ÷ 4. Centre the icon, never crop.

**State rules** — disabled drops opacity to 50% and `cursor-not-allowed`; busy shows spinner with the *same* label colour and label hidden behind it.

### 8.2 · Cards (feature, use-case)

```
bg: slate-900
border: 1px solid slate-800
radius: rounded-xl
padding: 24
hover: border becomes brand/40, shadow-glow, transform translateY(-2px)
```

Card title in `text-xl font-semibold`. Body in `text-base text-slate-400`.

### 8.3 · Badges / pills

- Pill: `rounded-full px-3 py-1 text-xs font-medium`
- Variants: `bg-brand/10 text-brand` (info), `bg-success/10 text-success` (status), `bg-slate-800 text-slate-300` (neutral)
- "v1.3.0" version badge on the hero uses neutral.

### 8.4 · Code block (CLI snippets)

```
bg: slate-900
border: 1px solid slate-800
radius: rounded-lg
padding: 16
font: Geist Mono, text-sm
text: slate-100
```

Add a copy button (top-right, ghost icon button) for any block longer than 1 line.

### 8.5 · Stats / counter

For the open-source section ("X stars, Y downloads, Z contributors"):

- Number: `text-5xl font-bold tracking-tight text-white`
- Label below: `text-sm text-slate-400 uppercase tracking-wider`
- Use `tabular-nums` so digit width doesn't jiggle on update.

### 8.6 · Form inputs (newsletter, future)

```
bg: slate-900
border: 1px solid slate-700
radius: rounded-md
padding: 12 16
focus: border becomes brand, ring 2px brand/40, no outline
```

---

## 9 · Iconography

- **Style** — Lucide-icons (outlined, 1.5–2px stroke, rounded line caps).
- **Default size** — 20px (inline with `text-base`), 24px in feature cards.
- **Colour** — inherit `currentColor` always. Never hard-code `stroke="#fff"`.
- **Custom** — for tool-specific glyphs (Claude, Cursor, OpenAI), use the official brand SVG, monochrome when on the bento grid.

---

## 10 · Imagery

### Screenshots / GIFs

- 1366×768 minimum, 1920×1080 ideal
- Always show real UI, not mockups
- Annotate with the brand blue (`#3B82F6`) for callouts
- `.webp` for stills, `.mp4` (autoplaying, muted, looped, `playsinline`) over GIFs for the hero — 10× smaller, sharper
- Provide a static poster frame (`.webp`) as fallback for `prefers-reduced-motion`

### Open Graph

- 1200×630 PNG
- Logo on the left, tagline on the right, dark background, hint of brand glow
- Same image used for Twitter, Discord, Slack previews

### Favicon

- 32×32 (default), 192×192 (Android), 512×512 (PWA), `apple-touch-icon` 180×180
- Always the lens icon alone, no wordmark — too small to read.

---

## 11 · Accessibility checklist (every component)

- [ ] Contrast ratio ≥ AA (4.5:1 body, 3:1 UI)
- [ ] Focus ring visible: 2px `brand`, offset 2px from element, never `outline: none`
- [ ] Touch target ≥ 44×44 on mobile
- [ ] Keyboard nav reaches every interactive element
- [ ] `aria-label` for icon-only buttons
- [ ] Heading hierarchy h1 → h2 → h3 (no skipping)
- [ ] `prefers-reduced-motion` honoured for any motion above hover-scale
- [ ] Form inputs labelled (visible label or `aria-label`)
- [ ] Skip-link "Jump to main content" first focusable element

---

## 12 · Tailwind 4 mapping (ready to paste)

```css
@theme {
  --color-brand: #3B82F6;
  --color-brand-dark: #2563EB;
  --color-success: #22C55E;
  --color-danger: #EF4444;
  --color-warning: #F59E0B;

  --font-sans: "Geist Sans", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --font-mono: "Geist Mono", Consolas, Menlo, monospace;

  --shadow-card: 0 1px 2px rgba(0,0,0,0.06), 0 1px 3px rgba(0,0,0,0.10);
  --shadow-card-hover: 0 4px 6px rgba(0,0,0,0.08), 0 10px 20px rgba(0,0,0,0.20);
  --shadow-glow: 0 0 32px rgba(59,130,246,0.45);

  --ease-out-quart: cubic-bezier(0.16, 1, 0.30, 1);
}
```

`slate-*`, `indigo-*`, `purple-*` come for free in Tailwind 4 — no need
to redefine. Just use them straight.
