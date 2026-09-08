---
name: Calm Wayfinding
colors:
  surface: '#121416'
  surface-dim: '#121416'
  surface-bright: '#38393c'
  surface-container-lowest: '#0c0e10'
  surface-container-low: '#1a1c1e'
  surface-container: '#1e2022'
  surface-container-high: '#282a2c'
  surface-container-highest: '#333537'
  on-surface: '#e2e2e5'
  on-surface-variant: '#d3c5ac'
  inverse-surface: '#e2e2e5'
  inverse-on-surface: '#2f3133'
  outline: '#9c8f79'
  outline-variant: '#4f4633'
  surface-tint: '#f9bd22'
  primary: '#ffe1a7'
  on-primary: '#402d00'
  primary-container: '#fbbf24'
  on-primary-container: '#6c4f00'
  inverse-primary: '#795900'
  secondary: '#4ae176'
  on-secondary: '#003915'
  secondary-container: '#00b954'
  on-secondary-container: '#004119'
  tertiary: '#dfe5ea'
  on-tertiary: '#2b3135'
  tertiary-container: '#c3c9ce'
  on-tertiary-container: '#4e5459'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#ffdf9f'
  primary-fixed-dim: '#f9bd22'
  on-primary-fixed: '#261a00'
  on-primary-fixed-variant: '#5c4300'
  secondary-fixed: '#6bff8f'
  secondary-fixed-dim: '#4ae176'
  on-secondary-fixed: '#002109'
  on-secondary-fixed-variant: '#005321'
  tertiary-fixed: '#dde3e8'
  tertiary-fixed-dim: '#c1c7cc'
  on-tertiary-fixed: '#161c20'
  on-tertiary-fixed-variant: '#41484c'
  background: '#121416'
  on-background: '#e2e2e5'
  surface-variant: '#333537'
typography:
  display:
    fontFamily: Manrope
    fontSize: 3rem
    fontWeight: '700'
    lineHeight: 3.5rem
    letterSpacing: -0.02em
  display-mobile:
    fontFamily: Manrope
    fontSize: 2.25rem
    fontWeight: '700'
    lineHeight: 2.75rem
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Manrope
    fontSize: 2rem
    fontWeight: '700'
    lineHeight: 2.5rem
    letterSpacing: -0.015em
  headline-lg-mobile:
    fontFamily: Manrope
    fontSize: 1.75rem
    fontWeight: '700'
    lineHeight: 2.25rem
    letterSpacing: -0.015em
  headline-md:
    fontFamily: Manrope
    fontSize: 1.5rem
    fontWeight: '600'
    lineHeight: 2rem
    letterSpacing: -0.01em
  headline-sm:
    fontFamily: Manrope
    fontSize: 1.25rem
    fontWeight: '600'
    lineHeight: 1.75rem
    letterSpacing: 0em
  body-lg:
    fontFamily: Public Sans
    fontSize: 1.125rem
    fontWeight: '400'
    lineHeight: 1.75rem
    letterSpacing: 0.01em
  body-md:
    fontFamily: Public Sans
    fontSize: 1rem
    fontWeight: '400'
    lineHeight: 1.5rem
    letterSpacing: 0.01em
  body-sm:
    fontFamily: Public Sans
    fontSize: 0.875rem
    fontWeight: '500'
    lineHeight: 1.25rem
    letterSpacing: 0.015em
  label-lg:
    fontFamily: Public Sans
    fontSize: 1.125rem
    fontWeight: '600'
    lineHeight: 1.5rem
    letterSpacing: 0.02em
  label-md:
    fontFamily: Public Sans
    fontSize: 0.875rem
    fontWeight: '600'
    lineHeight: 1.25rem
    letterSpacing: 0.03em
  label-sm:
    fontFamily: Public Sans
    fontSize: 0.75rem
    fontWeight: '700'
    lineHeight: 1rem
    letterSpacing: 0.05em
rounded:
  sm: 0.5rem
  DEFAULT: 1rem
  md: 1.5rem
  lg: 2rem
  xl: 3rem
  full: 9999px
spacing:
  base: 0.25rem
  touch-min: 3rem
  gutter-mobile: 1rem
  gutter-tablet: 1.5rem
  gutter-desktop: 2rem
  margin-mobile: 1.25rem
  margin-tablet: 2rem
  margin-desktop: 3rem
  gap-xs: 0.5rem
  gap-sm: 0.75rem
  gap-md: 1rem
  gap-lg: 1.5rem
  gap-xl: 2rem
  gap-2xl: 3rem
---

## Brand & Style

This design system delivers an assistive, high-assurance mobility interface designed for blind, low-vision, and situational-accessibility navigators. Rooted in tactile restraint, quiet ergonomics, and unambiguous signaling, it pairs industrial navigation utility with luxury-grade optical execution. The interface prioritizes sensory calm, spatial orientation, and cognitive ease under physical transit conditions.

### Core Visual Tenets
- **Ergonomic Restraint:** Surfaces recede into deep, velvety charcoals so directional cues and spatial advisories emerge with absolute authority.
- **Civic Legibility:** Layouts follow architectural wayfinding discipline—large tap targets, robust optical contrast, and explicit hierarchy that bypasses decorative clutter.
- **Instrument Precision:** Accents act strictly as semantic beacons, warning indicators, and trajectory vectors rather than atmospheric decoration.
- **Non-Gimmicky Tactility:** No glowing neon, floating synthetic holograms, or decorative particle effects. State changes, confirmations, and alerts are immediate, crisp, and predictable.

## Colors

The palette establishes an ultra-high-contrast foundation optimized for sub-optimal outdoor lighting, high-glare environments, and varying vision capabilities while avoiding ocular strain.

### Palette Architecture
- **Primary Signal (`#FBBF24`):** High-visibility guidance gold. Reserved for focal pathing, directional turn arrows, immediate action triggers, and primary interactive states. Delivers WCAG AAA contrast against dark core surfaces.
- **Success & Confirmation (`#22C55E`):** Semantic verification green. Indicates verified clear corridors, arrived status, active orientation tracking, and hardware sync confirmations.
- **Muted Functional Gray (`#9BA1A6`):** Secondary metadata, inactive indicators, dimensional dividers, and descriptive sub-labels. Retains a minimum 4.5:1 contrast against surface backgrounds.
- **Core Neutral (`#101214`):** Base canvas charcoal. Pure enough to minimize OLED display power draw and reduce night-blindness flare, yet balanced to eliminate the harsh chromatic vibration of pure `#000000`.
- **Raised Canvas Surface (`#181B1F`):** Container tiers, bottom-sheet guidance drawers, and tactical guidance cards.
- **High-Contrast Text (`#F4F4F6`):** Warm chalk white. Maximizes glyph definition, prevents letter blooming, and provides crisp reading at glanceable distances.
- **Hazard Warning (`#EF4444`):** Immediate obstruction, elevation drop, and path-blocked semantic signal.

## Typography

Typography prioritizes spatial legibility, distinct character shapes, and optical differentiation between numerals and directional indicators.

- **Headlines (Manrope):** Geometric clarity with softened apexes. Provides structural rhythm for turn distances, step counts, and macro navigation headers without aggressive angles.
- **Body & Labels (Public Sans):** A neutral civic grotesque engineered specifically for government and public signage clarity. Broad apertures, consistent stroke ratios, and disambiguated glyphs (e.g., distinguishing uppercase `I`, lowercase `l`, and numeral `1`) prevent misreading under high motion or visual blur.
- **Dynamic Sizing & Hierarchy:** Critical navigation steps enforce a minimum line height of 1.4x font size to prevent overlapping during OS-level dynamic type scaling. Small labels maintain slight letter-spacing expansions to guarantee optical separation at smaller point sizes.

## Layout & Spacing

The layout model is driven by one-handed ergonomics, accessible reach zones, and predictable scan anchors.

### Grid & Ergonomics
- **Fluid Single-Column Primary Anchor (Mobile):** Wayfinding interfaces position primary directional commands and actionable controls within the bottom 45% of the viewport (thumb-accessible zone).
- **Responsive Adaptations:**
  - **Mobile (<768px):** Single-column layout with 20px (`1.25rem`) safe outer margins. Active navigation cards stretch to full width. Touch targets meet or exceed the mandatory `48x48dp` (`touch-min`) bounding box, with standard interactive triggers defaulting to `56dp` height.
  - **Tablet (768px–1024px):** Split dual-pane canvas (6-column instruction panel + 6-column spatial radar overview) using 24px gutters and 32px margins.
  - **Desktop / Workstation (>1024px):** Fixed-width centered navigation column (max 880px) flanked by persistent sensor diagnostics and accessibility overrides.

### Rhythmic Discipline
All spatial intervals adhere strictly to a 4px/8px base unit rhythm. Elements never touch or overlap; inter-element spacing guarantees that accidental multi-touch events are mechanically impossible during physical walking movement.

## Elevation & Depth

Spatial separation avoids artificial drop shadows, relying instead on structural tone layering, defined edge boundaries, and controlled ambient diffusion.

### Depth Hierarchy
- **Base Level 0 (`#101214`):** Canvas ground. Represents inactive transit space and map/radar backgrounds.
- **Surface Level 1 (`#181B1F`):** Primary interaction surface, bottom-sheet trays, and standard cards. Framed with a 1px ghost border using `#9BA1A6` at 15% opacity to establish tactile edge definition without visual noise.
- **Surface Level 2 (`#22262B`):** Active routing cues, directional steps, and focused navigational items. Uses a 1px border of `#9BA1A6` at 25% opacity.
- **Alert / Floating Overlay (`#2A2F35`):** Time-sensitive turn banners, reroute notifications, and spatial alerts. Elevated by an ambient, non-directional shadow: `0 8px 32px rgba(0, 0, 0, 0.65)` and a subtle high-contrast border ring in `#FBBF24` (at 40% opacity for warning contexts, 100% for emergency intervention).

## Shapes

The geometry balances smooth handheld comfort with clean edge recognition.

- **Tokens & Radii:** Roundedness level `3` establishes an approachable, pill-like ergonomic contour across actionable items (`rounded-base` at `1rem`, `rounded-lg` at `2rem`, and full `rounded-full` / `3rem` for interactive chips, search bars, and floating controls).
- **Tactile Signaling:** Pill-shaped primary actions guide swipe gestures and thumb placement effortlessly. Sub-containers and large spatial cards utilize `rounded-lg` (24px–32px), creating a friendly, high-end physical hardware presence akin to precision-machined industrial devices.
- **Zero Razor Edges:** Sharp, acute-angled containers are strictly prohibited to maintain visual softness and eliminate optical harshness in peripheral vision.

## Components

Every component is constructed with tactile clarity, accessibility screen-reader properties, and rapid high-contrast recognition.

### Buttons
- **Primary Waypoint Action:** Full-width or oversized pill button. Background `#FBBF24`, text `#101214`, font `Manrope Bold` (`1.125rem`). Minimum height `56px`. Pressed state shifts tone to `#D97706`. Focus state exhibits a `4px` offset outline in `#F4F4F6`.
- **Secondary Guidance Action:** Charcoal pill surface (`#181B1F`), 1.5px border `#9BA1A6` (30% opacity), text `#F4F4F6`. Minimum height `48px`.
- **Confirmation Action:** Background `#22C55E`, text `#101214`. Used exclusively when completing routes, resolving obstacles, or locking settings.

### Cards & Directional Vectors
- **Instruction Banner:** Surface `#181B1F`, `rounded-lg` (24px radius), 1px stroke `#9BA1A6` (20% opacity). Houses the prominent turn-by-turn instruction: a high-contrast vector arrow in `#FBBF24`, distance typography in `Manrope Display Mobile`, and human-readable street names in `Public Sans Body-Lg`.
- **Obstacle Alert Card:** Surface `#181B1F`, highlighted with a left-aligned vertical anchor bar (6px width) in `#EF4444` or `#FBBF24`. Includes high-visibility typography and dual tactile dismissal buttons.

### Chips & Filter Toggles
- **Navigation Filter Chips:** Fully rounded pills (`rounded-full`), height `44px`, horizontal padding `20px`. Inactive state: background `#181B1F`, border `#9BA1A6` (20%), text `#9BA1A6`. Active state: background `#FBBF24`, text `#101214`, font weight 600. Includes distinct audio/haptic cues on state toggle.

### Lists & Waypoints
- **Wayfinding List Item:** Minimum touch height `64px`. Separated by 1px subtle divider lines (`#181B1F`). Each item includes a leading high-contrast icon container (40x40px, rounded-full, surface `#22262B`), primary label in `#F4F4F6`, and trailing contextual distance indicator in `#9BA1A6`.

### Inputs & Destination Search
- **Search Bar:** Pill-shaped (`rounded-full`), height `56px`, surface `#181B1F`, 1.5px border `#9BA1A6` (30%). Leading search symbol in `#FBBF24`. Input typography in `#F4F4F6` with placeholder text in `#9BA1A6`. Direct voice-input trigger positioned at trailing edge with a 48x48px hit target.

### Checkboxes & Segmented Controls
- **Accessible Checkbox:** Geometric square (`24x24px`) with `6px` radius inside a `48x48px` invisible tap wrapper. Unchecked: 2px border `#9BA1A6`. Checked: solid `#FBBF24` fill with `#101214` checkmark icon.
- **Segmented Mode Switcher:** Recessed container (`#101214`), height `52px`, pill-shaped. Active segment slides on `#181B1F` surface with crisp white text (`#F4F4F6`) and a gold indicator dot.