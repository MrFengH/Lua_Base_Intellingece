---
name: Lua
description: On-device metrology-ledger record of a hospital's installed medical equipment base
colors:
  paper: '#f2f4f5'
  surface: '#ffffff'
  surface-sunken: '#eceff1'
  ink: '#12181f'
  ink-secondary: '#47525c'
  ink-tertiary: '#5b6570'
  line: '#dfe3e6'
  line-strong: '#c5cdd1'
  accent: '#1c3f5e'
  accent-strong: '#122c45'
  accent-soft: '#e5eaf0'
  verified: '#1f6b4a'
  verified-soft: '#e3f0e9'
  estimated: '#8a5a12'
  estimated-soft: '#f5ecda'
  contradiction: '#a23b2e'
  contradiction-soft: '#f7e7e3'
  nav-bg: '#101820'
  nav-border: '#1f2a34'
  nav-text: '#8b9aa6'
  nav-text-active: '#f2f5f6'
  nav-active-bg: '#192531'
typography:
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: '23px'
    fontWeight: 400
    lineHeight: 1.1
    letterSpacing: '-0.3px'
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: '13px'
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: '9.5px'
    fontWeight: 700
    letterSpacing: '0.06em'
    textCase: 'uppercase'
  numeric:
    fontFamily: "ui-monospace, 'Cascadia Mono', 'Segoe UI Mono', Consolas, 'Liberation Mono', monospace"
    fontVariantNumeric: 'tabular-nums'
rounded:
  sm: '3px'
  md: '6px'
spacing:
  xs: '4px'
  sm: '8px'
  md: '12px'
  lg: '16px'
  xl: '24px'
components:
  button-primary:
    backgroundColor: '{colors.accent}'
    textColor: '#ffffff'
    rounded: '{rounded.sm}'
    padding: '9px 14px'
  button-primary-hover:
    backgroundColor: '{colors.accent-strong}'
  button-secondary:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.ink-secondary}'
    rounded: '{rounded.sm}'
    padding: '9px 14px'
  button-save:
    backgroundColor: '{colors.verified}'
    textColor: '#ffffff'
    rounded: '{rounded.sm}'
    padding: '12px'
  status-chip:
    rounded: '{rounded.sm}'
    padding: '3px 7px'
    typography: '{typography.label}'
---

# Design System: Lua

## Overview

**Creative North Star: "The Metrology Ledger"**

The app presents field observations as an instrument-grade record under construction — a
calibration certificate / metrology-report reading, not a chat product with a data sidebar
bolted on. It explicitly refuses the enterprise-SaaS ticket-console default and the pastel
chat-bubble default: no gradients, no pill badges, no eyebrows, no soft drop shadows, no emoji
or unicode glyphs. Structure is carried by hairline rules, flat rectangular stamps, and a
monospace register for anything that is a measurement, identifier, or timestamp — the visual
grammar of a document being assembled and signed off, not a conversation being had.

The palette is paper-neutral and restrained: a near-white ground, charcoal ink text, a single
deep ink-blue accent used sparingly for actions and active state, and three functional
stamp-colors (verified green, estimated amber, contradiction oxide-red) that never appear
decoratively — only as status. A near-black nav rail is the one deliberately darker surface in
the system, functioning as a fixed instrument bezel around the paper-bright workspace.

**Key Characteristics:**

- Flat, rectangular, hairline-bordered — no soft shadows, no pill shapes, no gradients
- One accent color (deep ink-blue), used only for primary actions and active/selected state
- Three functional stamp colors, reserved strictly for status (verified/estimated/contradiction)
- System-sans for prose, tabular monospace for every identifier, count, and timestamp
- Hand-drawn 1.75px stroke-SVG icons throughout; no emoji, no glyph fonts, no icon-font packs

## Colors

Paper-neutral ground with a single restrained accent and three reserved functional stamp colors.

### Primary

- **Ink Blue** (`#1c3f5e`): the sole accent. Primary buttons, active pipeline-stage markers,
  selected nav/list state, links (`.text-button`), facility-icon tint. Its hover/pressed state is
  **Ink Blue Deep** (`#122c45`).

### Neutral

- **Paper** (`#f2f4f5`): app background.
- **Surface** (`#ffffff`): panels, cards, the nav-rail's ledger counterpart, inputs.
- **Surface Sunken** (`#eceff1`): recessed fill for table headers, empty-state wells, hover rows.
- **Ink** (`#12181f`): primary text.
- **Ink Secondary** (`#47525c`): supporting text, descriptions, body copy in secondary contexts.
- **Ink Tertiary** (`#5b6570`): captions, field labels, timestamps, muted metadata (4.5:1 contrast
  on paper — a confirmed accessibility fix from the finish review, not the original build value).
- **Line** (`#dfe3e6`) / **Line Strong** (`#c5cdd1`): hairline dividers and borders; `Line Strong`
  is the heavier weight used on input/button borders and table foot-rules.
- **Nav Bezel Black** (`#101820`, border `#1f2a34`, muted text `#8b9aa6`, active text `#f2f5f6`,
  active-row fill `#192531`): the fixed instrument-rail surface — the one place the system goes
  dark, distinct from every workspace panel.

### Named Rules (optional, powerful)

**The One Accent Rule.** Ink Blue (`#1c3f5e`) is the only non-functional, non-neutral color in
the system. It marks exactly one thing: what is actionable or currently selected. It never
appears as decoration or as a status indicator.

**The Stamp, Not Decoration Rule.** Verified green (`#1f6b4a`), estimated amber (`#8a5a12`), and
contradiction red (`#a23b2e`) are reserved for their semantic meaning only (confidence level,
record state, duplicate/conflict relationship). They do not appear as arbitrary UI accents.

## Typography

**Body/UI Font:** System sans stack (`-apple-system, BlinkMacSystemFont, 'Segoe UI', Inter,
ui-sans-serif, system-ui, sans-serif`) — no display font, no remote/web font.
**Label/Mono Font:** `ui-monospace, 'Cascadia Mono', 'Segoe UI Mono', Consolas, 'Liberation Mono',
monospace` with `font-variant-numeric: tabular-nums`.

**Character:** A single system-sans stack for all prose keeps the interface anonymous and
document-like rather than branded; the monospace register is reserved for anything that is
measured, counted, or timestamped, giving the record its instrument/ledger credibility at a
glance.

### Hierarchy

- **Title** (400, 23–24px, tight tracking `-0.3px`): page and screen headings (`.page-heading h1`,
  `.capture-title h1`).
- **Section Title** (700, 13px): panel/section headers (`.section-title h3`).
- **Body** (400, 12–13px, line-height 1.5): transcript text, descriptions, table cell prose.
- **Label** (700, 9–10px, `0.05–0.06em` tracking, uppercase): field labels, table column headers,
  status-chip text, role tags — the recurring small-caps register for anything structural rather
  than conversational.
- **Numeric/Mono** (650–700, sizes vary, tabular figures): equipment ages, evidence IDs,
  timestamps, dashboard stat counts, ledger detail values — anywhere a value must read as
  measured data, not prose.

### Named Rules (optional)

**The Mono-For-Measurement Rule.** Any value that is counted, dated, or identified (ages, IDs,
timestamps, stat counts, table numerics) renders in the monospace stack with tabular figures.
Prose never does, even at small sizes.

## Layout

Fixed 212px dark nav rail on the left (`position: fixed`, `.app-shell` as a two-column grid),
workspace filling the remainder. Capturar splits its content area into two columns at
`minmax(440px, 44fr) / minmax(480px, 56fr)` — a narrower transcript log against a wider
structured ledger panel, collapsing to a near-even split (`minmax(400px,1fr) / minmax(420px,1fr)`)
under 1220px. Customer 360 uses a 296px directory rail against a flexible detail pane. Page
padding is generous and consistent (26–36px page-level, 8–20px component-level); vertical rhythm
inside panels runs on an 8–12px grid. `body { min-width: 1080px }` — this is a desktop-only
surface, not a responsive-down-to-mobile one.

## Elevation & Depth

The system is flat by default: panels, cards, and rows are distinguished by hairline borders
(1px `--line` / `--line-strong`) and background-tone shifts (`--surface` vs `--surface-sunken`),
never by drop shadow. The single exception is the transient error banner
(`box-shadow: 0 8px 22px rgb(30 10 8 / 0.28)`), which is a fixed overlay notification, not a
resting surface — its shadow signals "floating above the page," not ambient card elevation.
Active/selected state is conveyed by a full 1px border plus a soft fill tint (e.g.
`.customer-index button.selected`, `.main-nav nav button.active`), never by a colored
border-left accent bar or an offset box-shadow — a finish-review fix that replaced both prior

> 1px colored-edge "active" treatments with this flat vocabulary.

### Named Rules (optional)

**The No-Shadow-At-Rest Rule.** Resting surfaces carry zero box-shadow. Hierarchy comes from
hairline borders and neutral-tone fills. The only shadow in the system belongs to a
fixed/floating overlay, never to a card, panel, or button.

## Shapes

Corners are minimal and restrained throughout: `3px` (`--radius-sm`) on chips, buttons, inputs,
and small controls; `6px` (`--radius-md`) on larger containers (cards, chart panels, ledger
tables, the duplicate-review panel). Circles appear only for the pipeline-stage index markers and
status dots — every other shape is a flat rectangle. Borders are always 1px hairlines; there are
no pill shapes, no clipped/angled corners, and no decorative borders wider than 1px anywhere in
the build.

## Components

### Buttons

- **Shape:** flat rectangle, `3px` radius (`--radius-sm`) throughout.
- **Primary:** `--accent` (`#1c3f5e`) background, white text, 1px `--accent` border, `9px 14px`
  padding, 650 weight. Hover/pressed deepens to `--accent-strong` (`#122c45`).
- **Secondary:** white/`--surface` background, `1px --line-strong` border, `--ink-secondary` text;
  hover shifts border and text to `--accent`.
- **Save (signature variant):** full-width, `--verified` green fill, white text, `12px` padding,
  13px font — visually distinct from primary to mark the one irreversible "commit to record"
  action.
- **Text/Ghost:** no border or fill, `--accent` text, used for inline links (e.g. "edit").
- **Icon button:** 26×26px square, 1px `--line-strong` border, white background — used for
  compact controls (candidate navigation, dismiss).

### Chips (status stamps)

- **Style:** flat rectangle, `3px` radius, uppercase label type (9.5px, 750 weight, `0.05em`
  tracking), 1px transparent (or colored, for `chip-caution`) border. Never a pill (`border-radius`
  is always the `sm` token, never 50% or a large value).
- **State:** semantic fill classes only — `chip-verified` (green), `chip-estimated` (amber),
  `chip-contradiction` (red), `chip-caution` (amber outline, transparent fill), `chip-info`
  (accent-soft), `chip-neutral` (sunken gray). These map directly to confidence level, record
  state, provenance knowledge, and duplicate-relationship enums — never to arbitrary emphasis.

### Cards / Containers

- **Corner Style:** `6px` radius (`--radius-md`) for card-level containers (chart cards, account
  stats, installed-base ledger, evidence table, duplicate-review panel); `3px` for nested/smaller
  elements.
- **Background:** `--surface` (white) on `--paper` ground; `--paper` is used once, deliberately,
  as the recessed fill inside the duplicate-review card to distinguish it as a sub-panel.
- **Shadow Strategy:** none — see Elevation & Depth.
- **Border:** always 1px `--line` (or `--line-strong` for emphasis/table foot-rules).
- **Internal Padding:** 13–20px for card bodies; 8–16px for nested rows.

### Inputs / Fields

- **Style:** 1px `--line-strong` border, `3px` radius, white/`--surface` background, 8px padding.
- **Focus:** no custom focus ring observed beyond browser default; the composer textarea is
  borderless inside its own bordered container.
- **Disabled:** buttons drop to `0.5` opacity and `cursor: not-allowed`.

### Navigation

- **Style:** fixed 212px dark rail (`--nav-bg #101820`), muted `--nav-text` (`#8b9aa6`) labels,
  13px, flat rectangular items with 2px gap.
- **Default:** transparent background, muted text.
- **Hover:** `#16202a` fill, brightens text to `--nav-text-active`.
- **Active:** `--nav-active-bg` (`#192531`) fill, `--nav-text-active` text, 650 weight — background
  and weight only, no colored edge accent (finish-review fix).
- **Customer directory (secondary nav list):** same pattern — selected state is `--accent-soft`
  fill with a full 1px `--accent` border, not a border-left accent bar.

### Pipeline Tracker (signature component)

A 5-stage horizontal tracker (capture → seguimiento → revisión → confirmación → guardado) is the
Capturar screen's structural signature: a thin connecting hairline, circular numbered markers
(28px, `--line-strong` border) that fill solid `--accent` when done and outline-highlight when
active, with uppercase 10.5px labels beneath. It is the clearest expression of the "record under
construction" thesis and should not be reused for anything that isn't a genuine sequential
process state.

### Registro Estructurado Ledger (signature component)

The bordered ledger panel — facility letterhead block, gridded equipment table with inline status
stamps, and full bordered contradiction notices (not colored-bar callouts) — is the document-grade
counterpart to the plain transcript log. Contradictions render as a complete bordered/tinted block
with an icon and bold lead-in, never as a thin colored sidebar accent.

## Do's and Don'ts

### Do:

- **Do** use flat rectangles with 1px hairline borders (`--line` / `--line-strong`) for all
  structural division; radius stays at `3px` or `6px` only.
- **Do** reserve `--accent` (`#1c3f5e`) for actionable/selected state only, and the three
  stamp colors for their exact semantic meaning (verified/estimated/contradiction).
- **Do** render every identifier, timestamp, age, and count in the monospace stack with tabular
  figures.
- **Do** use uppercase, letter-spaced (0.05–0.06em) 9–10px labels for field labels, chip text, and
  table headers — the system's one recurring small-caps register.
- **Do** use hand-drawn 1.75px-stroke SVG icons (`icons.tsx`, 24 viewBox, `currentColor`) for every
  icon; never an emoji, unicode glyph, or icon font.
- **Do** convey active/selected state with a background-tint plus full 1px border, never a
  colored border-left/box-shadow accent bar.

### Don't:

- **Don't** add box-shadow to a resting card, panel, button, or chip — shadows belong only to
  fixed/floating overlays (e.g. the error banner).
- **Don't** use pill-shaped (`border-radius: 999px`/`50%`) chips, buttons, or badges — the
  radius scale stops at `6px`.
- **Don't** introduce a gradient anywhere in the system.
- **Don't** add an eyebrow/kicker line above headings — none exist in the build, and the direction
  contract explicitly refuses them; do not invent one for a new screen.
- **Don't** use a second accent color for emphasis. If a new screen needs another color, it must
  be a genuine new status class (with its own soft/solid pair), not a decorative one-off.
