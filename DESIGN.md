---
name: SportsTech
description: Dark athletic commerce and dense operations for SportsTech PH.
colors:
  ground: "#0b0b0c"
  surface: "#141416"
  raised: "#1c1c1f"
  well: "#1f1f22"
  line: "#2a2a2f"
  field: "#101012"
  ink: "#f4f4f5"
  ink-2: "#a8a8b0"
  ink-3: "#8b8b93"
  white: "#ffffff"
  primary: "#ef4444"
  primary-strong: "#dc2626"
  primary-deep: "#b91c1c"
  secondary: "#f4f4f5"
  success: "#22c55e"
  warning: "#f59e0b"
typography:
  display:
    fontFamily: '"Barlow Condensed", "Arial Narrow", ui-sans-serif, system-ui, sans-serif'
    fontSize: "clamp(3.125rem, 8vw, 6rem)"
    fontWeight: 800
    lineHeight: 0.95
    letterSpacing: "0.005em"
  headline:
    fontFamily: '"Barlow Condensed", "Arial Narrow", ui-sans-serif, system-ui, sans-serif'
    fontSize: "clamp(2rem, 5vw, 4.5rem)"
    fontWeight: 800
    lineHeight: 0.95
    letterSpacing: "0.005em"
  title:
    fontFamily: '"Barlow Condensed", "Arial Narrow", ui-sans-serif, system-ui, sans-serif'
    fontSize: "1.125rem"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "0.02em"
  body:
    fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
    fontSize: "0.875rem"
    fontWeight: 600
    lineHeight: 1.2
  figure:
    fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
    fontSize: "1rem"
    fontWeight: 600
    lineHeight: 1.2
    fontFeature: "tabular-nums"
rounded:
  control: "0.5rem"
  media: "0.75rem"
  card: "0.875rem"
  surface: "1rem"
  pill: "999px"
spacing:
  xs: "0.5rem"
  sm: "0.75rem"
  md: "1rem"
  lg: "1.5rem"
  xl: "2rem"
  control-y: "0.625rem"
  control-x: "1.25rem"
  touch: "44px"
  print-touch: "48px"
components:
  button-primary:
    backgroundColor: "{colors.primary-strong}"
    textColor: "{colors.white}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "0.625rem 1.25rem"
    height: "44px"
  button-primary-hover:
    backgroundColor: "{colors.primary-deep}"
    textColor: "{colors.white}"
    rounded: "{rounded.pill}"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "0.625rem 1.25rem"
    height: "44px"
  button-light:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.ground}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "0.625rem 1.25rem"
    height: "44px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink-2}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "0.625rem 0.75rem"
    height: "44px"
  icon-button:
    backgroundColor: "transparent"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.pill}"
    size: "44px"
  input-field:
    backgroundColor: "{colors.field}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "0.625rem 0.875rem"
    height: "44px"
  chip:
    backgroundColor: "transparent"
    textColor: "{colors.ink-2}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "0 1rem"
    height: "40px"
  chip-active:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.ground}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "0 1rem"
    height: "40px"
  surface-panel:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.surface}"
    padding: "1.5rem"
  dialog-sheet:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.surface}"
---

# Design System: SportsTech

## Overview

**Creative North Star: "Category Standard"**

SportsTech is dark athletic commerce played straight: a near-black shop and a calm, dense operations console at the craft level of Nike, adidas and JOOLA. The system is conventional on purpose. Product images, peso totals, order state and the SportsTech logo do the work; the interface supplies confidence through flat charcoal surfaces, precise red actions and condensed uppercase display type.

Provenance matters: the owner chose Category Standard over the rolled direction, and the incumbent dark slate glass world was replaced. This document records the built world, not the old one: no slate glass, blur, glow, gradient chrome or neon belongs in the canon. The permanent brand commitments are the SportsTech logo, the red theme accent, Philippine peso pricing and factual copy for fees, schedules and payment instructions.

**Key Characteristics:**
- Near-black ground with flat charcoal panels and hairline borders.
- One red family for primary action, active selection and PWA chrome.
- Barlow Condensed uppercase display for athletic authority; platform sans for reading, forms and money.
- Tabular peso figures, explicit status labels and visible read-only state.
- Mobile-first commerce with a dense owner console and a 48px print-queue action floor.

## Colors

The palette is a disciplined black-and-red athletic system: red is rare and decisive, while depth comes from charcoal steps rather than glass or glow.

### Primary
- **SportsTech Action Red**: Used for brand accent, action emphasis, active icons, selected count badges and the PWA theme color.
- **Filled Action Red**: Used for filled primary buttons where white text must read cleanly.
- **Deep Action Red**: Used for filled-button hover and active reinforcement.

### Secondary
- **White Pill**: Used for secondary commerce actions that need more weight than an outline, especially post-checkout actions.

### Neutral
- **Near-Black Ground**: The app and storefront background; also the manifest background.
- **Flat Charcoal Surface**: Primary card, panel, sidebar and dialog material.
- **Raised Charcoal**: Announcement bars, toasts and inset notices.
- **Product Well Charcoal**: Product/image wells and thumbnail placeholders.
- **Hairline Divider**: Borders, table rules and panel dividers.
- **Main Ink**: Primary text and active labels.
- **Muted Ink**: Secondary explanatory text and inactive navigation labels.
- **Quiet Ink**: Placeholder text, inactive icons and count metadata.
- **Field Black**: Form input ground.

### Named Rules
**The One Red Rule.** Primary red is action, selection and brand confirmation; it does not wash panels or decorate backgrounds.

**The No Glass Rule.** The legacy `glass-*` names are implementation aliases only; their visual meaning is flat surface, hairline border and no backdrop blur.

## Typography

**Display Font:** Barlow Condensed, self-hosted through `@fontsource`, with Arial Narrow and system sans fallbacks.
**Body Font:** platform sans, using the UI system stack.
**Label/Mono Font:** platform sans with tabular numerals for money and operational counts.

**Character:** Barlow Condensed gives SportsTech the straight athletic category voice: uppercase, compressed, heavy and sometimes italic in hero/sign-in moments. Body copy stays plain and fast to scan; money and counts use tabular figures so totals do not jitter.

### Hierarchy
- **Display** (800, clamp up to the 6rem ceiling, 0.95 line-height): Store hero headlines, completion states and major page titles.
- **Headline** (800, fluid 2rem–4.5rem, 0.95 line-height): Product sheets, print queue references and high-emphasis empty/error states.
- **Title** (700, 1.125rem, uppercase, 0.02em tracking): Section titles, checkout steps and production subsections.
- **Body** (400, 1rem, 1.5 line-height): Reading text, forms, notes and operational descriptions; long copy stays around 65–72ch.
- **Label** (600, 0.875rem, 1.2 line-height): Field labels, chips, compact buttons, nav group labels and status badges.
- **Figure** (600+, tabular): Peso totals, item counts, KPI figures, order references and quantities.

### Named Rules
**The Condensed Authority Rule.** Barlow Condensed is for titles, hero phrases, section titles and KPI figures; it is not body copy.

**The Money Is Data Rule.** Peso prices, counts and order references use tabular numerals and must keep their label or context visible.

## Layout

The storefront uses a max-width 7xl retail frame, a 36px announcement bar, a sticky 64px black header, a photo hero that lands at roughly 312px on phones and 540px on desktop, then a three-fact strip before the product grid. Product listing is two columns on phones, three at small desktop and four at large desktop, with bag and checkout presented as a drawer that becomes a full-height sheet on phones.

The back office uses a 248px desktop sidebar grouped by job, a 64px desktop header, and a scrollable content well capped at max-width 7xl. On phones it switches to a compact header and a fixed 64px bottom tab bar with POS, Orders, Dashboard and Menu; Menu opens the complete grouped drawer. The print queue is a single-column max-width 3xl flow with large job references and thumb-reachable actions.

Spacing is dense but not cramped: controls use 44px minimum height, print controls use at least 48px, panels usually carry 16–24px internal padding, compact rows use 12–16px vertical padding, and section separation is larger above headings than below. Safe-area padding is used for mobile sheets and bottom bars.

## Elevation & Depth

SportsTech is flat by default. Depth is conveyed through tonal charcoal layers, 1px dividers and overflow clipping; shadows are reserved for overlays, toasts, autocomplete lists and sheets. The storefront hero uses a photographic court overlay to make text legible, but gradients are not a chrome or brand effect.

### Shadow Vocabulary
- **Lift Shadow** (`0 12px 32px -12px rgb(0 0 0 / 0.7), 0 2px 6px -2px rgb(0 0 0 / 0.5)`): Toasts and floating menus that must sit above the work surface.
- **Sheet Shadow** (`0 -16px 48px -16px rgb(0 0 0 / 0.8)`): Mobile bottom sheets and drawers.

### Named Rules
**The Flat-By-Default Rule.** Resting surfaces are flat charcoal panels with hairline borders; shadows appear only when a layer floats above the current task.

## Shapes

The form language is blunt athletic retail: rounded enough to be touchable, never bubbly. Controls use 8px corners, product media and choice cards use 12px corners, production notices use 14px, primary panels and dialogs use 16px, and chips/buttons are full pills. Product wells landed as slightly rounded charcoal wells in the build, not the square-cornered intention from the direction contract.

### Named Rules
**The Blunt Athletic Shape Rule.** Large surfaces stay rectangular with 12–16px corners; full pills are reserved for compact actions, chips and icon buttons.

## Components

### Buttons
- **Shape:** Full pill for actions and icon buttons; minimum height is 44px, with 48px in print production.
- **Primary:** Filled Action Red with white text; used for the one forward action in a flow.
- **Hover / Focus:** Hover darkens to Deep Action Red; keyboard focus uses a high-contrast white outline with offset.
- **Secondary / Ghost / Light:** Secondary is transparent with a hairline border; ghost is quiet text over a subtle white hover; light is an ink-filled pill for high-visibility secondary commerce actions.

### Chips
- **Style:** 40px full pills with a hairline border, semibold label and muted ink.
- **State:** `aria-pressed="true"` flips to ink background on ground text. Filter chips always expose their selected state semantically.

### Cards / Containers
- **Corner Style:** Surface panels use 16px corners; product wells and thumbnails use 8–12px corners.
- **Background:** Flat Charcoal Surface over Near-Black Ground, with Raised Charcoal for embedded strips and notices.
- **Shadow Strategy:** No resting card shadow; overlays use the Elevation vocabulary.
- **Border:** Hairline Divider on every panel edge, row separator and table rule.
- **Internal Padding:** 16px for compact mobile surfaces, 20–24px for desktop panels and dialogs.

### Inputs / Fields
- **Style:** Field Black fill, Hairline Divider stroke, 8px radius, 15–16px text and at least 44px height.
- **Focus:** Border shifts to Main Ink and the global white focus outline remains visible.
- **Error / Disabled:** Errors use text plus red-tinted surface; disabled controls reduce opacity and retain a disabled cursor/title when read-only.

### Navigation
- **Style:** Desktop admin uses grouped sidebar labels and 40–44px nav rows; active items use a subtle white wash and red icon, never a red block. Mobile uses a 64px bottom tab bar with four equal targets and red active icons.
- **Storefront:** Header stays black, sticky and logo-led; the bag count bumps once when items are added.
- **Drawer:** The mobile menu uses the same dialog drawer system as the cart: surface fill, border edge and sheet shadow.

### Status, Alerts and Read-Only
- **Status:** Status is always text plus color. Paid/unpaid, fulfillment, print and sync states never rely on color alone.
- **Read-only:** The amber read-only snapshot/maintenance banner is always visible when active, and mutation controls disable through `ReadOnlyContext`.
- **Alerts:** Error, warning and success treatments use tinted borders/backgrounds with readable labels and icons.

### Product Tile and Product Sheet
- **Tile:** Product imagery sits in a charcoal well; the product name is semibold, brand is muted, and price uses tabular numerals.
- **Sheet:** Product detail opens in a dialog/sheet with square-ish media, radio-button size/quantity grids, sticky add-to-bag or checkout totals and factual shipping/payment copy.

### Production / Print Queue
- **Style:** Large Barlow Condensed job references lead each card. Counts sit in divided cells with tabular figures.
- **Targets:** Print actions use at least 48px height, and mobile production actions expand to a two-column grid with the final action spanning full width.

## Do's and Don'ts

### Do:
- **Do** keep SportsTech on Near-Black Ground with Flat Charcoal Surface panels and Hairline Divider rules.
- **Do** reserve Filled Action Red for the primary action, selected icons/counts and theme chrome.
- **Do** use Barlow Condensed uppercase for page titles, KPI figures and hero headlines, with platform sans for everything else.
- **Do** show peso pricing and order totals as tabular figures with clear labels.
- **Do** keep the amber read-only banner visible and disable every mutation control through the read-only context.
- **Do** respect reduced motion globally and keep focus rings, text selection, caret color and scrollbars themed.
- **Do** maintain minimum 12px text, 44px touch targets and 48px print-queue targets.

### Don't:
- **Don't** revive the discarded slate-glass look: no decorative glass, backdrop blur, glow, neon or gradient chrome.
- **Don't** use color as the only status indicator; every state needs visible text.
- **Don't** invent testimonials, ratings, sales claims or brand photography standards not supplied by the product truth.
- **Don't** use system display faces as the display voice; Barlow Condensed is the self-hosted display face.
- **Don't** add kickers, eyebrow labels, generic icon-card page scaffolds or gradient text to future surfaces.
- **Don't** turn the synthetic fixture imagery from review screenshots into a photography rule.
