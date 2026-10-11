# MeetingBuddy design system and UI plan

Status: **revision 2, decisions applied** (see §10). Nothing in `src/` has been changed yet. This document is the contract for the UI rebuild. Implementation starts only after it is approved.

## 0. Sources and scope

**What the redesign covers:** the whole renderer (`src/renderer/src`), which today is five files plus one 117-line `styles.css`:

| File | Today |
|---|---|
| `App.tsx` | App shell, sidebar, recording bar, banners, home empty state, Start recording and New project dialogs, all recording control logic |
| `ProjectView.tsx` | Project header, 4 tabs (Project state board, Meetings, Stakeholders, Change history), Edit project, Item editor with history, Paste transcript |
| `MeetingView.tsx` | Meeting header, transcript pane, Impact Report with proposal cards, Edit proposal, Map speakers, Rename |
| `SettingsView.tsx` | AI model, Speech-to-text, Detection and hotkeys |
| `ui.tsx` | `useAction`, `Modal`, `clickable`, `Field`, `ErrorBox`, `useTick`, `useEvent` |

The main process, IPC, preload and data model are **out of scope**. The rebuild uses the existing `api` proxy and `MainEvents` as they are. The only exception is the **theme setting** (§2, §9 Step 0): one new `theme` field in `Settings`/`SETTINGS_FIELDS`, plus `nativeTheme.themeSource` and the window background colour in `index.ts`.

**Figma inspiration:** *Meeting Notes & Productivity Dashboard UI Kit* ("MeetMind AI").
- Inspected: the full variable set (colours, Geist type styles, padding, radius, shadow), the component page structure, and screenshots of the cover (6 dashboard screens as thumbnails) and of the Sidebar/Header components.
- The file has only two pages: a cover and a component library. There are no full-size screen frames, so screen layouts here are adapted from the cover thumbnails and component specs, not copied.
- Screenshots of the Buttons, Badge, Input and Table frames were blocked by the Figma Starter-plan MCP rate limit. Their variant names and tokens were read, so their specs below come from those.

**Use of the kit:** inspiration only. We take its calm light-neutral surfaces, Geist typography, green brand colour, soft-tinted badges, 32/36/40 control sizes, and sidebar/top-bar structure. Its features (playlists, coaching, deals, upgrade plans, voice agents) don't exist in MeetingBuddy and are not carried over.

---

## 1. Design principles

MeetingBuddy answers one question: *what changed in the project because of this meeting?* The UI should make that question, and its evidence, the most visible thing on every screen.

1. **The project state is the hero, not the meeting.** Meetings are inputs; the board of requirements, decisions, tasks, risks, deadlines and questions is the output. Navigation, colour and hierarchy all point back to the state and to how a meeting changes it.
2. **Evidence is always one click away.** Every proposed change shows its verbatim quote, the speaker and the timestamp. Clicking a quote jumps to the transcript line. Quotes get a distinct, recognisable treatment (§4 `EvidenceQuote`) that is never decorative.
3. **Calm by default, loud only when action is needed.** Neutral, near-white surfaces with one brand colour. Colour is reserved for meaning: a type of item, the kind of change, a status that needs the user. Recording is the only element allowed to pulse.
4. **Review is a workflow, not a page.** The Impact Report is a queue: see a proposal, check the evidence, then accept, edit or reject it, and finally apply. Progress (pending / accepted / rejected) is always visible, and the Apply step is always in the same place.
5. **Trust through explicitness.** Destructive and state-removing actions (delete, close, supersede, apply) are labelled plainly and confirmed in-app. Errors say what happened and what to do next, and never disappear on their own.
6. **Desktop-native density.** This is a work tool used for hours on a laptop. Use 14 px body text, 36 px default controls and compact lists, and make it keyboard-first. It is not a marketing site.

**Look and feel:** light, airy and precise. White cards on an off-white canvas, hairline borders, almost no shadow, Geist type with slight negative tracking, a confident green accent and soft-tinted pill badges. Dark mode is a first-class peer, not an afterthought, because people record meetings at any hour and the current app is dark-only.

**Why light-first:** the Figma kit is light, and long reading sessions (transcripts, reports) favour dark-on-light. We follow the OS setting by default (`prefers-color-scheme`) and allow an override in Settings, so current dark-mode users keep dark.

---

## 2. Design tokens

Tokens are defined once, as CSS custom properties, in `src/renderer/src/styles/tokens.css`. They are exposed to **Tailwind CSS v4** through its `@theme` block (§5.1), so every token below is also a utility class:

| Token | Tailwind utility |
|---|---|
| `--color-surface` | `bg-surface` |
| `--color-fg-secondary` | `text-fg-secondary` |
| `--text-title` | `text-title` (size, line height and weight together) |
| `--radius-xl` | `rounded-xl` |
| 16 px spacing | `p-4`: Tailwind's default 4 px spacing scale already matches the kit (§2.4) |

Components use **semantic tokens only** (`bg-surface`, `text-danger-fg`), never raw palette values (`bg-gray-100`) or arbitrary hex (`bg-[#f1f1f1]`). Tailwind's default colour palette is removed in `@theme` (`--color-*: initial`), so a raw colour utility doesn't exist and can't be typed by mistake. Themes swap the semantic layer.

**Theme selection** has three options: **System (default)**, Light and Dark.
- The choice is stored as a new `theme: 'system' | 'light' | 'dark'` setting in `settings.json`. That means adding it to `Settings`, `SETTINGS_FIELDS` and the defaults.
- Main applies it with `nativeTheme.themeSource = settings.theme`. Chromium then reports the matching `prefers-color-scheme` to the renderer, and main also sets the window `backgroundColor` from `nativeTheme.shouldUseDarkColors`, so there's no white or black flash at launch.
- The CSS keys off that one signal: semantic tokens are redefined under `@media (prefers-color-scheme: dark)`, and Tailwind's `dark:` variant uses the same media query, which is Tailwind v4's default.
- When the user picks "System", Windows' own light/dark switch takes effect live, with no JS involved.
- `useTheme()` only reads and writes the setting through the existing `api.getSettings`/`api.saveSettings`.

### 2.1 Palette (raw, from Figma unless marked *derived*)

Values marked *derived* aren't in the kit. They were added to reach WCAG AA where the kit's own tone fails (see §8.1).

**Neutral**

| Token | Hex | Figma name |
|---|---|---|
| `--gray-0` | `#ffffff` | General/white, bg-secondary |
| `--gray-25` | `#fafafa` | bg-primary-hover |
| `--gray-50` | `#f9f9f9` | bg-primary |
| `--gray-100` | `#f1f1f1` | Gray/100, bg-secondary-hover |
| `--gray-200` | `#e9e9e9` | Gray/200, border-secondary |
| `--gray-300` | `#e5e5e5` | Gray/300, border-primary, bg-disabled |
| `--gray-400` | `#d4d4d4` | *derived* (input borders) |
| `--gray-500` | `#8e8e8e` | Icon/disabled, border-focused |
| `--gray-600` | `#696e6e` | *derived* from Text/disabled `#717676` (that one fails 4.5:1 on `#f9f9f9`) |
| `--gray-700` | `#575757` | Text/tertiary |
| `--gray-800` | `#373737` | Icon/secondary |
| `--gray-850` | `#2d2d2d` | Text/secondary |
| `--gray-900` | `#111111` | Gray/900, Icon/primary |
| `--gray-950` | `#000000` | Gray/950 |

**Brand green**

| Token | Hex | Figma name |
|---|---|---|
| `--green-50` | `#e6f5ef` | Badge/Primary-shade |
| `--green-100` | `#ccebdf` | Primary/50 |
| `--green-200` | `#b3e2cf` | Primary/100 |
| `--green-300` | `#66c49e` | Primary/300 |
| `--green-400` | `#33b17e` | Primary/400 |
| `--green-500` | `#009d5e` | Primary/500, Button/primary |
| `--green-600` | `#007e4b` | Primary/600 |
| `--green-700` | `#006640` | *derived* (hover/pressed) |
| `--green-900` | `#002f1c` | Primary/900 |

> **Key decision:** the kit fills primary buttons with `#009d5e`. White 14 px text on it is only about **3.5:1**, which fails AA. Our primary fill is **`--green-600` `#007e4b` (about 5.1:1)**. `#009d5e` is kept for non-text brand marks: logo, focus ring, progress fill, the selected sidebar indicator. Those need 3:1 and pass.

**Accent hues.** Each hue has four tokens:
- `soft`: a tinted background
- `border`
- `text`: text on `soft`, ≥ 4.5:1
- `solid`: a filled background with white text, ≥ 4.5:1

| Hue | soft | border | text | solid | Source |
|---|---|---|---|---|---|
| red | `#f9ebeb` | `#e8aeae` | `#9e2a2a` | `#c63435` | Badge/Red*, Red/600 |
| green | `#edf6f3` | `#b5ddcd` | `#1f6b4e` *d* | `#007e4b` | Badge/success* |
| yellow | `#fff8ec` | `#ffe3b4` | `#5f4314` | `#ffb844` (dark text `#3d2a07`) | Badge/Yellow*, Yellow/900 |
| blue | `#e8f3fd` | `#a1d1f5` | `#175ba8` *d* | `#1f6fd1` *d* | Badge/Blue* |
| purple | `#f6e9fe` | `#dba8fa` | `#6f19a6` *d* | `#831ec2` | Badge/Purple*, Purple/600 |
| pink | `#ffedff` | `#ffb9fe` | `#8f1f8c` *d* | `#b02bad` *d* | Badge/Pink* |
| orange | `#fef2e9` | `#fbcba7` | `#94480f` *d* | `#ad5518` *d* | Badge/Orange* |
| teal | `#ecfafd` | `#b1eaf6` | `#1d6575` *d* | `#237a8c` *d* | Badge/Teal* |
| neutral | `#f1f1f1` | `#e5e5e5` | `#373737` | `#111111` | Badge/black* |

### 2.2 Semantic colour tokens

Names are chosen to read well as Tailwind utilities: `--color-surface` becomes `bg-surface`, `--color-fg-secondary` becomes `text-fg-secondary`, and `--color-line` becomes `border-line`.

| Token | Utility example | Light | Dark | Use |
|---|---|---|---|---|
| `--color-canvas` | `bg-canvas` | gray-50 `#f9f9f9` | `#0e0f0f` | Window canvas |
| `--color-surface` | `bg-surface` | gray-0 `#ffffff` | `#161717` | Cards, sidebar, dialogs |
| `--color-raised` | `bg-raised` | gray-0 | `#1d1e1f` | Menus, popovers, toasts |
| `--color-hover` | `hover:bg-hover` | gray-25 `#fafafa` | `#222324` | Row/item hover |
| `--color-selected` | `bg-selected` | gray-100 `#f1f1f1` | `#26282a` | Selected nav item, pressed ghost button |
| `--color-inset` | `bg-inset` | gray-50 | `#121313` | Transcript well, kbd |
| `--color-disabled` | `bg-disabled` | gray-300 | `#232425` | Disabled controls |
| `--color-line` | `border-line` | gray-200 `#e9e9e9` | `#2b2c2e` | Card/section hairlines |
| `--color-line-strong` | `border-line-strong` | gray-400 `#d4d4d4` | `#3a3c3e` | Inputs, stroke buttons |
| `--color-line-hover` | `hover:border-line-hover` | gray-500 `#8e8e8e` | `#6b6e72` | Input hover |
| `--color-fg` | `text-fg` | gray-900 `#111111` | `#ededed` | Primary text |
| `--color-fg-secondary` | `text-fg-secondary` | gray-700 `#575757` | `#a3a3a3` | Meta, labels |
| `--color-fg-tertiary` | `text-fg-tertiary` | gray-600 `#696e6e` | `#8a8a8a` | Hints, timestamps |
| `--color-fg-disabled` | `text-fg-disabled` | gray-500 | `#5f6163` | Disabled labels (exempt from contrast) |
| `--color-fg-inverse` | `text-fg-inverse` | `#ffffff` | `#04140d` | Text on accent/solid fills |
| `--color-icon` | `text-icon` | gray-800 | `#c9c9c9` | Default icon |
| `--color-accent` | `bg-accent` | green-600 `#007e4b` | green-400 `#33b17e` | Primary button fill |
| `--color-accent-hover` | `hover:bg-accent-hover` | green-700 | green-300 | |
| `--color-accent-soft` | `bg-accent-soft` | green-50 | `rgb(51 177 126 / .14)` | Soft primary button, selected chips |
| `--color-accent-fg` | `text-accent-fg` | green-600 | `#4fc492` | Links, accent text on surfaces |
| `--color-brand` | `bg-brand` | green-500 `#009d5e` | green-400 | Logo, progress, selected indicator |
| `--color-focus` | `ring-focus` | green-500 | green-400 | Focus ring |
| `--color-overlay` | `bg-overlay` | `rgb(17 17 17 / .40)` | `rgb(0 0 0 / .60)` | Dialog backdrop |

**State colours.** Each has `-soft`, `-line`, `-fg`, `-solid` and `-on` (light values from §2.1's soft/border/text/solid columns; `-on` is the text colour on `-solid`: white, except dark brown on yellow and near-black on dark-mode green). Examples: `bg-danger-soft`, `border-danger-line`, `text-danger-fg`, `bg-danger-solid`.

| Role | Hue | Used for |
|---|---|---|
| `--color-success-*` | green | Accepted proposal, Applied, saved, `create` op |
| `--color-warning-*` | yellow | Needs review, tentative, `supersede` op, skipped changes |
| `--color-danger-*` | red | Errors, delete, conflict/`flag` op, high impact |
| `--color-info-*` | blue | Processing/analyzing, `update` op, informational banners |
| `--color-record-*` | red | Recording only. Same hue as danger, but a separate token so recording UI can diverge later. |

The categorical hues (blue, purple, teal, orange, pink, plus red, green, yellow and neutral) get the same four tokens: `--color-blue-soft`, `--color-blue-line`, `--color-blue-fg` and `--color-blue-solid`, and likewise for the rest. They are used only through the domain badge components (§4.3).

In dark mode:
- `-soft` is the hue at 14% alpha over the surface, and `-line` at 35%.
- `-fg` uses light tones: red `#f08b8b`, green `#5fd3a2`, yellow `#ffc966`, blue `#79b8ff`, purple `#c792f5`, pink `#ff8bfd`, orange `#f7a065`, teal `#6fdaf0`.
- `-solid` keeps the light-mode value, except green, which becomes green-400 with dark text.

**Domain colour mapping.** This is categorical, so it is never the only cue: a label or icon always accompanies the colour.

| Domain value | Hue | Icon (lucide name) |
|---|---|---|
| Item `requirement` | blue | `list-checks` |
| Item `decision` | purple | `gavel` |
| Item `task` | teal | `square-check` |
| Item `risk` | red | `triangle-alert` |
| Item `deadline` | orange | `calendar-clock` |
| Item `question` | pink | `circle-help` |
| Op `create` → "New" | green | `plus` |
| Op `update` → "Change" | blue | `pencil` |
| Op `close` → "Close" | neutral | `circle-check` |
| Op `supersede` → "Replaces" | yellow | `replace` |
| Op `flag` → "Conflict" | red | `zap` |
| Meeting `recording` | record (with pulsing dot) | `mic` |
| Meeting `transcribing` / `analyzing` | info (with spinner) | `loader` |
| Meeting `ready` | neutral | `file-text` |
| Meeting `analyzed` → "Needs review" | warning | `inbox` |
| Meeting `applied` | success | `check` |
| Impact `high` / `medium` / `low` | danger / warning / neutral | none |

**Speaker colours.** Avatars and transcript speaker names take a stable hue from `hash(speaker) % 8` over blue, purple, teal, orange, pink, green, yellow and neutral, using the `-fg` tone on the `-soft` tone. The local user (`settings.selfName`) is always green.

### 2.3 Typography

**Family:** **Geist** (UI) and **Geist Mono** (timestamps, kbd, version numbers, short refs).
- Both come from `@fontsource-variable/geist` and `@fontsource-variable/geist-mono` (OFL), imported in `styles/index.css`. Vite bundles the `woff2` files into the app, which the renderer CSP (`default-src 'self'`) requires; no Google Fonts.
- Each subset is a separate file with a `unicode-range`, so only the subsets a page actually uses are loaded. Italics aren't imported (§4.3 `EvidenceQuote` doesn't use them).
- Fallback: `"Segoe UI Variable", "Segoe UI", system-ui, sans-serif`.
- Numerals use `font-variant-numeric: tabular-nums` wherever they change in place (timers, counts, confidence).

The scale follows the kit (12/14/16/18/20) and adds two display steps for page titles.

| Token | Size / line height | Weight | Tracking | Use |
|---|---|---|---|---|
| `--text-display` | 28 / 34 | 600 | -0.02em | Empty-state and onboarding headline |
| `--text-title` | 22 / 28 | 600 | -0.02em | Page title (`PageHeader`) |
| `--text-heading` | 18 / 24 | 600 | -0.015em | Section headings, dialog titles |
| `--text-subheading` | 16 / 22 | 600 | -0.01em | Card titles, report group headings |
| `--text-body` | 14 / 20 | 400 | -0.005em | Default UI and body text |
| `--text-body-strong` | 14 / 20 | 500 | -0.005em | Buttons, nav items, item titles |
| `--text-reading` | 15 / 24 | 400 | 0 | Transcript lines, summary, quotes (longer reading) |
| `--text-small` | 12 / 16 | 400 or 500 | 0 | Meta, badges, labels, hints |
| `--text-mono` | 12 / 16 | 400 | 0 | Timestamps, kbd, `v3` |

In Tailwind, each step is one `@theme` font-size token, with its line height, weight and tracking set in the same place (for example `--text-title--line-height` and `--text-title--font-weight`). One class such as `text-title` therefore applies the whole style. `--font-sans` is Geist and `--font-mono` is Geist Mono.

Weights: 400 regular, 500 medium, 600 semibold. **No 700**: Geist at 600 is heavy enough, and fewer weights means less font weight to load. The kit's "-2" tracking is -2%, and we only apply it at 16 px and above.

### 2.4 Spacing (4 px base; names follow the kit's `Padding/*`)

We use Tailwind's default spacing scale unchanged: `--spacing: 4px`, so `p-1` = 4 px and `gap-3` = 12 px. It matches the kit's padding tokens exactly, so there are no custom spacing tokens. Use only the steps below; Biome can't enforce this, so code review must.

| Kit name | px | Tailwind | Typical use |
|---|---|---|---|
| | 2 | `0.5` | Icon/text optical nudge |
| xxs | 4 | `1` | Badge padding-y, tight gaps |
| xs | 8 | `2` | Gap between inline controls, icon–label |
| sm | 12 | `3` | Compact card padding, list row padding |
| md | 16 | `4` | Card padding, stack gap |
| lg | 20 | `5` | Section gap |
| xl | 24 | `6` | Page gutter, dialog padding |
| | 32 | `8` | Page section separation |
| | 40 | `10` | Empty-state padding |
| | 64 | `16` | Onboarding hero |

### 2.5 Radius

| Token | px | Use |
|---|---|---|
| `--radius-xs` | 4 | kbd, checkbox, small chips |
| `--radius-sm` | 6 | Badges, sm buttons, tooltips |
| `--radius-md` | 8 | Buttons, nav items, menu items (kit `Radius/s`) |
| `--radius-lg` | 10 | Inputs, selects, textareas (kit `Radius/m`) |
| `--radius-xl` | 12 | Cards, board columns, proposal cards (kit `Radius/l`) |
| `--radius-2xl` | 16 | Dialogs, toasts |
| `--radius-full` | 999 | Avatars, status dots, switch, pill badges |

### 2.6 Elevation

Elevation is mostly expressed by surface colour and a hairline border. Shadows are rare and soft.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--shadow-xs` | `0 1px 2px rgb(9 25 72 / .06)` (kit "Shadow") | none | Cards, stroke buttons |
| `--shadow-sm` | `0 2px 6px rgb(9 25 72 / .06), 0 1px 2px rgb(9 25 72 / .04)` | `0 0 0 1px #2b2c2e` | Hovered interactive cards |
| `--shadow-md` | `0 8px 24px rgb(9 25 72 / .10), 0 2px 6px rgb(9 25 72 / .06)` | `0 8px 24px rgb(0 0 0 / .5), 0 0 0 1px #2b2c2e` | Menus, popovers, toasts |
| `--shadow-lg` | `0 24px 64px rgb(9 25 72 / .18)` | `0 24px 64px rgb(0 0 0 / .6), 0 0 0 1px #2b2c2e` | Dialogs |
| `--shadow-focus` | `0 0 0 2px var(--color-surface), 0 0 0 4px var(--color-focus)` | same | Focus ring (§8.3) |

**Z-index:**

| Layer | Value |
|---|---|
| `--z-sticky` | 10 |
| `--z-sidebar` | 20 |
| `--z-dropdown` | 30 |
| `--z-banner` | 40 |
| `--z-overlay` | 50 |
| `--z-dialog` | 60 |
| `--z-toast` | 70 |
| `--z-tooltip` | 80 |

### 2.7 Sizing

| Token | Value |
|---|---|
| `--control-sm` | 32 px (kit Small) |
| `--control-md` | 36 px (kit Medium; default) |
| `--control-lg` | 40 px (kit Large; primary CTAs in dialogs and empty states) |
| `--icon-sm` / `--icon-md` / `--icon-lg` | 16 / 18 / 20 px |
| `--sidebar-w` | 248 px |
| `--sidebar-rail-w` | 64 px |
| `--topbar-h` | 56 px |
| `--content-max` | 1440 px |
| `--reading-max` | 760 px (Stakeholders, History, Settings forms) |

### 2.8 Breakpoints

This is an Electron window, so the breakpoints are window widths. `BrowserWindow` has `minWidth: 900` and a default of 1280×820.

| Name | Range | Behaviour |
|---|---|---|
| `compact` | 900–1099 px | Sidebar collapses to the icon rail. The meeting page shows Transcript/Report as tabs, not a split. The board has 2 columns. |
| `regular` | 1100–1439 px | Full sidebar. The meeting page is split 5:7. The board has 3 columns. |
| `wide` | ≥ 1440 px | Content is capped at `--content-max` and centred. The board has 3 columns with more breathing room (6 columns is too narrow for card text). |

In Tailwind they are the `regular:` and `wide:` variants (§5.1). Styles are written compact-first: unprefixed classes are the compact layout, and `regular:` / `wide:` add to them. JS reads the breakpoints only where the component tree has to change (split → tabs), through `useMediaQuery`.

### 2.9 Motion tokens

| Token | Value |
|---|---|
| `--dur-instant` | 80 ms (press feedback) |
| `--dur-fast` | 120 ms (hover, colour changes) |
| `--dur-base` | 180 ms (menus, tooltips, accordion) |
| `--dur-slow` | 260 ms (dialogs, toasts) |
| `--ease-out` | `cubic-bezier(.2, .8, .2, 1)` (enter) |
| `--ease-in` | `cubic-bezier(.4, 0, 1, 1)` (exit) |
| `--ease-standard` | `cubic-bezier(.4, 0, .2, 1)` (move/resize) |

---

## 3. Layout system

### 3.1 App shell

```
┌────────────┬──────────────────────────────────────────────────────────┐
│ Sidebar    │ TopBar  [Breadcrumbs ............]  [● Recording 12:04 ■] │  56 px
│ 248 px     │         or                          [Capture ▾]           │
│            ├──────────────────────────────────────────────────────────┤
│ ◆ Meeting- │ BannerStack (detected meeting / persistent alerts)        │  0..n × 44 px
│   Buddy    ├──────────────────────────────────────────────────────────┤
│            │ Content (scrolls)                                         │
│ PROJECTS + │   PageHeader: title, meta, actions                        │
│ ▸ Apollo   │   Tabs (project pages)                                     │
│ ▸ Hermes   │   Page body                                                │
│            │                                                            │
│ ───────    │                                                            │
│ ⚙ Settings │                                                            │
│ SetupCard  │                                                            │
└────────────┴──────────────────────────────────────────────────────────┘
                                                        ToastRegion (bottom-right)
```

- **Sidebar** (`--color-surface`, right hairline): `Brand`, then the **Projects** section (list with a "+" icon button), then a spacer, then an **Others** section (Settings), then `SetupCard`.
  - This follows the kit's "Main Menu / Others / Upgrade card" structure. The upgrade card becomes a **setup checklist card**: it shows when no LLM key or no STT provider is configured, and otherwise collapses to a hotkey hint (`Ctrl+Shift+R to record`).
  - In `compact` mode it becomes a 64 px rail: brand mark, project initials as avatar buttons with tooltips, and the settings icon.
- **TopBar** (light surface, bottom hairline, not the kit's dark navy bar: we keep chrome calm and reserve strong colour for recording):
  - Left: breadcrumbs (`Apollo › Meetings › Weekly sync`).
  - Right: the **Capture** split button, adapted from the kit's "Capture ▾". Its main action is "Record meeting" and its menu has "Paste transcript…", "Import transcript file…" and "Import recording…".
  - While recording, Capture is replaced by the **RecordingPill**: pulsing dot, title, timer, Mark moment, Stop. The current full-width red recording bar goes away, but the recording state is still impossible to miss.
- **BannerStack**: persistent, dismissable notices that need a decision (meeting detected → Record / Ignore). Transient messages ("Recording saved…") move to **toasts**.
- **Content**: `p-6` (24 px), `max-width: var(--content-max)`, centred. Each page owns its own scroll, except the meeting page, whose two panes scroll independently.

### 3.2 Page anatomy

```
PageHeader
  [Back link?]  Title (text-title)            [Secondary actions] [Primary action]
  Meta line (text-small, secondary): dates, counts, status badge
Tabs (optional, project pages)
Toolbar (optional): filters, toggles, counts               [Page-level actions]
Body
```

### 3.3 Grid

- **Base unit: 4 px.** All spacing and sizes are multiples of 4, and most are multiples of 8.
- There is no global 12-column grid. Pages are tool-shaped, so each body uses one of three layouts:
  1. **Board:** `grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 16px`. With six item-type columns this gives 3×2 at `regular`/`wide` and 2×3 at `compact`.
  2. **Split** (meeting page): `grid-template-columns: minmax(360px, 5fr) 7fr; gap: 20px`. Both panes are `height: calc(100vh - topbar - header)` with their own scroll. At `compact` it becomes `Tabs` with Transcript / Impact report.
  3. **Reading column** (Stakeholders, History, Settings): a single column at `max-width: var(--reading-max)`. Settings adds a 200 px sticky section nav on the left at `regular`+ (from the kit's Settings "General / Meeting Settings…" sub-nav).

### 3.4 Responsive behaviour summary

| Element | compact (900–1099) | regular (1100–1439) | wide (≥1440) |
|---|---|---|---|
| Sidebar | 64 px rail + tooltips | 248 px | 248 px |
| TopBar breadcrumbs | Last 2 crumbs | Full | Full |
| Board | 2 cols | 3 cols | 3 cols, centred |
| Meeting page | Tabs | Split 5:7 | Split 5:7, capped |
| Meetings table | Hides "Source" column | All columns | All columns |
| Settings | Section nav becomes top Tabs | Side nav | Side nav |
| Dialogs | `min(560px, 100vw - 48px)` | Same | Same |

---

## 4. Component inventory

Conventions for every component:
- A function component with typed props.
- `className` is forwarded and merged last through `cn()` (`clsx` + `tailwind-merge`), so a caller's `mt-4` wins over a component default. `...rest` is spread onto the root, so `aria-*` and `data-*` pass through.
- **Variants are declared with `class-variance-authority` (`cva`)**, the usual enterprise Tailwind pattern (shadcn/ui and similar), in a `*.variants.ts` file next to the component. Variant props are typed from the `cva` definition with `VariantProps<typeof buttonVariants>`, so a misspelt variant is a compile error.
- The component also sets `data-variant` / `data-size` / `data-state` on its root. Tests and the occasional parent selector (`group-data-[state=accepted]:`) can then target state without depending on utility class strings.
- No ad-hoc `className` soup in features: a class list that is repeated, or longer than about 8 utilities, becomes a variant or a small component.
- Interactive components use native elements (`<button>`, `<input>`, `<dialog>`) wherever possible.
- **Standard states:** default, hover, focus-visible, active/pressed, disabled, and loading where it applies. Disabled uses the `disabled` attribute, never only a class, and is styled as `bg-disabled` / `text-fg-disabled` with no opacity hacks, because those break contrast on dark mode.

### 4.1 Primitives (`components/ui/`)

#### Button

Maps to the kit's `Buttons [1.0]`: Type × Style × State × Size × Only Icon.

```ts
type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'soft' | 'ghost' | 'danger' | 'danger-soft' | 'record'  // default 'secondary'
  size?: 'sm' | 'md' | 'lg'          // 32 / 36 / 40, default 'md'
  icon?: LucideIcon                   // leading icon, e.g. icon={Plus}
  iconRight?: LucideIcon
  loading?: boolean                   // shows Spinner in place of icon, sets aria-busy, disables
  fullWidth?: boolean
}
```

| Variant | Kit equivalent | Look |
|---|---|---|
| `primary` | Primary/Filled | `--color-accent` fill, inverse text |
| `secondary` | Neutral/Stroke | Surface fill, `--color-line-strong`, `--shadow-xs` |
| `soft` | Primary/Lighter | `--color-accent-soft` fill, accent text |
| `ghost` | Neutral/Ghost | Transparent, `--color-selected` on hover |
| `danger` | Error/Stroke | Surface fill, danger text and border |
| `danger-soft` | Error/Lighter | Danger-soft fill, danger text |
| `record` | (new) | Record-solid fill, white text, with a dot icon |

- States: hover darkens the fill by one step (or gets `--color-hover` for secondary/ghost); active translates 0.5 px down (`--dur-instant`); focus shows `--shadow-focus`; disabled uses disabled tokens with `cursor: not-allowed`.
- Loading keeps the width (the label stays, the icon becomes a spinner), so the layout doesn't jump. It is wired to `useAction().busy`.
- Text is sentence case, verb-first ("Apply 3 changes", not "Apply"). Text symbols like "✓" and "●" are replaced by real icons.

#### IconButton
`Button` with only an icon. It requires `label: string`, which becomes its `aria-label` and tooltip. Square, sizes sm/md/lg. Variants: `ghost` (default), `secondary`, `danger`.

#### SplitButton
A primary action plus a chevron that opens a `Menu`. Used by Capture. Props: `label`, `icon`, `onClick`, `items: MenuItem[]`, `variant`, `size`.

#### Icon
Icons come from **`lucide-react`**: outline icons on a 24 grid with `currentColor`, close to the kit's outline set. They are imported by name (`import { Mic } from 'lucide-react'`), so unused icons are tree-shaken.
- Components take icons as `LucideIcon` component props (`icon={Mic}`), never as strings.
- A thin `<Icon icon={Mic} size="sm|md|lg" label?>` wrapper applies our sizes (16/18/20 px), `strokeWidth={1.75}` and `aria-hidden` unless `label` is passed. Use it instead of rendering lucide components directly.
- The domain → icon mapping (§2.2) lives in `lib/labels.ts`, next to the labels, so it is defined once.

#### Badge
Maps to the kit's Badge: Color × Type (Filled / Outline + Shade / Shade / Outline).

```ts
type BadgeProps = {
  tone?: 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info' | 'blue' | 'purple' | 'teal' | 'orange' | 'pink' | 'red' | 'green' | 'yellow'
  appearance?: 'soft' | 'soft-outline' | 'outline' | 'solid'   // default 'soft-outline'
  size?: 'sm' | 'md'          // 20 / 24 px tall
  icon?: LucideIcon
  dot?: boolean               // leading status dot; `pulse` animates it (recording only)
  pulse?: boolean
  children: ReactNode
}
```

Badges aren't interactive. Domain wrappers (below) choose tone, icon and label so call sites can't drift: `ItemTypeBadge`, `OpBadge`, `MeetingStatusBadge`, `ImpactBadge`, `ItemStatusBadge`.

#### Input, Textarea, Select
Maps to the kit's Input Field and Text Area states: Default, Hover, Active/Focused, Typing, Filled, Disabled, Error.

```ts
type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  size?: 'sm' | 'md' | 'lg'
  leading?: LucideIcon | ReactNode   // e.g. search icon
  trailing?: ReactNode             // e.g. Kbd, clear button, show/hide for keys
  invalid?: boolean                // sets aria-invalid, danger border
}
```

- `Textarea` adds `autoGrow?: boolean` and `minRows?`.
- `Select` is a styled native `<select>` with a chevron, for reliability and keyboard support. A custom listbox isn't needed.
- `SecretInput` is `Input type=password` with a show/hide `IconButton` (from the kit's Password type). It is used for API keys and never pre-filled.
- States:
  - border `--color-line-strong`
  - hover `--color-line-hover`
  - focus: accent border plus `--shadow-focus`
  - invalid: danger border, plus `text-danger-fg` helper text below
  - disabled: `--color-disabled`

#### Field
Wraps a control with its label, hint and error, and wires up `id`, `htmlFor` and `aria-describedby` automatically through `useId`. This replaces today's `<label className="field">`.

```ts
type FieldProps = { label: string; hint?: ReactNode; error?: string | null; required?: boolean; optional?: boolean; children: ReactElement }
```

#### Checkbox, Switch, Radio / RadioCardGroup
These map to the kit's Checkbox, Toggle and Radio.
- `Switch` is used for binary settings ("Detect meetings automatically", "Show done / superseded").
- `RadioCardGroup` is new, inspired by the kit's Integrations cards. It is used for choosing the LLM and STT provider: each option is a card with name, one-line hint and a "Key saved" badge. It is `role="radiogroup"` with arrow-key navigation.

#### Tabs
Maps to the kit's Tab Menu (horizontal, underline indicator).

```ts
type TabsProps = { value: string; onChange: (v: string) => void; items: { value: string; label: string; count?: number; icon?: LucideIcon }[]; size?: 'sm' | 'md' }
```

It uses the WAI-ARIA tabs pattern (`role=tablist/tab/tabpanel`, roving tabindex, ←/→ Home/End). `SegmentedControl` is a pill variant used for small toggles, such as the Transcript/Report switch at `compact` and the theme choice.

#### Card
`<Card padding="sm|md|lg" interactive? selected? as?>`: surface, hairline border, `--radius-xl`, `--shadow-xs`. `interactive` adds hover (`--shadow-sm` plus `--color-line-hover`) and must be paired with a button or `clickable()`.

#### Dialog
Replaces `Modal`. It is built on native `<dialog>` with `showModal()`, which gives focus trapping, inertness of the page behind, top-layer stacking and Escape to close for free.

```ts
type DialogProps = { open: boolean; onClose: () => void; title: string; description?: ReactNode; size?: 'sm' | 'md' | 'lg'; footer?: ReactNode; children: ReactNode; dismissible?: boolean /* false while saving */ }
```

- Widths: sm 420, md 560, lg 720.
- The header has the title and a close `IconButton`. The body scrolls. The footer is sticky, right-aligned, with the primary action rightmost; destructive actions sit far left.
- Focus goes to the first field or the primary button, and returns to the trigger on close.

#### ConfirmDialog
Replaces every `window.confirm` (5 call sites today).

```ts
confirm({ title, body, confirmLabel, tone: 'danger' | 'warning' | 'default' }): Promise<boolean>   // via useConfirm()
```

The confirm button names the action ("Delete project", not "OK"). For irreversible deletes, initial focus goes to **Cancel**.

#### Menu
A popover menu for SplitButton, row overflow (`…`) and the project context menu. `role="menu"`, arrow keys, typeahead, Escape returns focus.

```ts
type MenuItem = { label: string; icon?: LucideIcon; onSelect: () => void; disabled?: boolean; tone?: 'danger'; shortcut?: string }
```

#### Tooltip
Shown on hover after 500 ms, and immediately on focus. It is text-only and never holds essential information: anything essential is also in the label or `aria-label`. It is used for icon buttons, rail items, confidence %, and "why is this disabled" reasons (today these are `title=` attributes).

#### Toast / ToastRegion
Transient confirmations and background progress ("Recording saved. Transcribing in the background…").
- `useToast().show({ tone, title, body?, action? })`.
- Toasts are bottom-right and stack up to 3. They auto-dismiss after 6 s, which pauses on hover or focus. **Error toasts never auto-dismiss.**
- The region is `role="status"`, or `role="alert"` for errors.
- This replaces the current single `banner` string and its 9 s timeout.

#### Banner (InlineAlert)
A persistent message inside a page or the BannerStack.

```ts
type BannerProps = { tone: 'info' | 'success' | 'warning' | 'danger'; title?: string; children: ReactNode; actions?: ReactNode; onDismiss?: () => void }
```

It replaces `ErrorBox` and `.error`. Uses: the meeting error with "Transcribe recording", the skipped-changes list, the detected meeting, the "no STT provider" notice.

#### EmptyState
`{ icon, title, body, action?, secondaryAction? }`. Centred, with an icon in a soft circle, `--text-subheading` title and body max 420 px. Copy always says what to do next.

#### Skeleton
`<Skeleton className>` sized with utilities, plus presets `SkeletonText lines`, `SkeletonCard` and `SkeletonRow`. It has a shimmer (§7). This replaces `return null` while loading.

#### Spinner
16/20 px ring, `currentColor`, `role="status"` with `aria-label`.

#### ProgressBar
Determinate and indeterminate. It is used in `SetupCard` (setup steps done) and in `ReviewBar` (proposals reviewed / total). The kit's segmented "upgrade" progress style is used for `SetupCard`.

#### Avatar
`{ name, size: 'xs'|'sm'|'md', tone? }`. Initials in a coloured circle (speaker colour rule from §2.2). It is used for speakers, stakeholders, owners and projects (in rail mode).

#### Kbd
Keyboard shortcut chip. It renders `CommandOrControl` as `Ctrl` (this logic exists in `App.tsx` today).

#### Other small primitives
- `Divider`
- `VisuallyHidden`
- `Timestamp`: `{ seconds }` renders `fmtTime` in mono tabular; `{ iso }` renders `fmtDate` and puts the full date in a tooltip.
- `Stat`: a number and a label, used for the project summary strip, inspired by the kit's dashboard stat cards.

### 4.2 Layout components (`components/layout/`)

| Component | Props | Notes |
|---|---|---|
| `AppShell` | `sidebar`, `topbar`, `banners`, `children` | CSS grid; owns the compact/regular switch |
| `Sidebar` | `projects`, `currentProjectId`, `onSelect`, `onNewProject`, `onSettings`, `active` | Collapses to a rail at `compact` |
| `SidebarSection` | `title`, `action?`, `children` | "Projects", "Others" |
| `SidebarItem` | `icon \| avatar`, `label`, `active`, `badge?`, `onClick` | A real `<button>`; `aria-current="page"` when active; kit Nav Items states |
| `SetupCard` | `settings` | Setup checklist / hotkey hint |
| `TopBar` | `breadcrumbs`, `right` | |
| `Breadcrumbs` | `items: { label, onClick? }[]` | `<nav aria-label="Breadcrumb">` |
| `PageHeader` | `title`, `meta?`, `back?`, `actions?`, `editableTitle?` | |
| `Toolbar` | `left`, `right` | |
| `SplitPane` | `left`, `right`, `compactTabs: [string, string]` | Splits into tabs at `compact` |
| `ScrollPane` | `children`, `label` | A labelled region with its own scroll and a gradient edge |

### 4.3 Feature components (`features/*`)

**Projects** (`features/projects/`)
- `ProjectSummaryStrip`: `Stat` × 3 ("12 open items", "2 meetings need review", "Last change 3 days ago"). It uses `listItems`, `listMeetings` and `listStateVersions`, which already exist.
- `NewProjectDialog` and `EditProjectDialog`. Delete moves into an explicit danger zone and uses `ConfirmDialog`.

**State board** (`features/board/`)
- `StateBoard { projectId }`: data loading plus the `meeting:changed` subscription.
- `BoardColumn { type, items, onAdd, onOpen }`: header with `ItemTypeBadge`, count and an add `IconButton`; it shows an empty hint in the column.
- `ItemCard { item, onOpen }`: title (2-line clamp), and a meta row with `Avatar` owner, due date (orange when within 7 days, red when past), and `v3` when the item has changed. Done, superseded and cancelled items are dimmed with an `ItemStatusBadge`. It is a real `<button>`.
- `ItemDialog { item | draft, onClose, onSaved }`: a popup (`Dialog`, size `lg`) with two sections:
  - The edit form: type, status, title, details, owner and due date.
  - Below it, the collapsible "History" timeline (`ItemHistory`). It is open by default when the item has history, so the evidence behind the item is visible without extra clicks.

  Delete sits far left in the footer and goes through `ConfirmDialog`. The dialog body scrolls while the footer stays fixed.
- `ItemHistory { entries }`: a vertical timeline. Each entry has a summary, meeting link, date and `EvidenceQuote`.

**Meetings list** (`features/meetings/`)
- `MeetingTable { meetings, onOpen }`, from the kit's Table Component. Columns are Title, Date, Source, Status and a "Needs attention" icon. Rows are buttons, sorted newest first. There is no pagination, because per-project lists are short.
- `CaptureMenu { projectId }`: the SplitButton. It owns the paste/file/audio import actions now in `Meetings`.
- `PasteTranscriptDialog`: keeps its current behaviour, where the pasted text is kept on failure.
- `MeetingStatusBadge`.

**Meeting page** (`features/meeting/`)
- `MeetingHeader`: back link, editable title, meta (date · source · N lines), `MeetingStatusBadge`, and actions (Map speakers, Analyze / Re-analyze, overflow `…` → Delete).
- `PipelineStepper`: `Captured → Transcribed → Analyzed → Reviewed → Applied`. It shows where the meeting is and what's next. The current step shows a spinner while it is processing, and an error marks its step in danger.
- `TranscriptPane { segments, marks, highlightId, live }`: a `ScrollPane` with a sticky speaker filter (chips) and an "N lines" count. When live, it auto-scrolls to the bottom unless the user has scrolled up; in that case a "Jump to latest" pill appears.
- `TranscriptLine { segment, marked, highlighted }`: a mono timestamp gutter, then a speaker `Avatar` and name, then text in `--text-reading`. A marked line has an amber left rail and a star icon. A highlighted line has a warning-soft background, which fades after 2 s.
- `ImpactReport`: `ReportSummary`, then `ProposalGroup`s in impact order (the current `REPORT_ORDER`), then the empty state.
- `ReportSummary { report, counts }`: the "What changed" summary in `--text-reading`, plus the model name, counts and the dropped-for-evidence notice.
- `ProposalGroup { category, proposals }`: heading with the category label and count. It can be collapsed.
- `ProposalCard { proposal, target, onJump, onStatus, onEdit }`: see §6.6 for the anatomy. Its states are pending, accepted, rejected and applied.
- `FieldDiff { label, before, after }`: `due  ~~Nov 1~~ → Nov 20`.
- `EvidenceQuote { quote, speaker, t, onJump }`: a real `<button>`. It has a 2 px left rail in the speaker's colour and shows the quote in the reading style, not italic, because italic Geist is a synthesized slant. The `— Speaker · 12:04` caption is below the quote. On hover or focus it shows a "Show in transcript" hint.
- `ReviewBar`: sticky at the bottom of the report pane. It shows a progress bar (`7 of 9 reviewed`), the "Accept all firm" button (with the existing rules: firm, confidence ≥ 0.7, never close/supersede) and the primary "Apply 5 changes" button. It's always in the same place.
- `SkippedChangesBanner`, `EditProposalDialog`, `SpeakerMapDialog` (with `Avatar` and a stakeholder combobox via `datalist`), `RenameMeetingDialog` (or inline title edit).

**Recording** (`features/recording/`)
- `useRecordingController()`: **all recording logic extracted unchanged from `App.tsx`**: start, stop, mark, hotkeys, `meeting:ended`, `app:quit-requested`, `setRecordingState`.
- `RecordingPill`: a pulsing dot, the title (truncated), a timer in mono tabular, a Mark moment `IconButton` (star, with Kbd tooltip), and Stop (`record` variant, sm).
- `StartRecordingDialog`: project select and title. It includes the consent note as an info `Banner`, not muted small text.
- `DetectedMeetingBanner`.
- `recorder.ts`: moved here, unchanged.

**Stakeholders** (`features/stakeholders/`)
- `StakeholderTable`: Avatar, Name, Role and Email, with a row overflow → Remove.
- `AddStakeholderForm`: an inline row of three inputs and an Add button. Enter submits.

**History** (`features/history/`)
- `HistoryTimeline`: vertical timeline grouped by date.
- `VersionCard`: meeting title (a link to open it) or "Manual change", the date, the change count, and `ChangeRow`s.
- `ChangeRow`: `OpBadge`, `ItemTypeBadge`, the title, and `FieldDiff`s for updates.

**Settings** (`features/settings/`)
- `SettingsNav`.
- `ModelSection`: `RadioCardGroup` of providers, model `Input`, base URL, `SecretInput`, the Test connection button with its result `Banner`, and "Remove saved key".
- `TranscriptionSection`.
- `RecordingSection`: self name, chunk length, detection `Switch`, and hotkeys.
- `AppearanceSection`: a new theme `SegmentedControl` with System / Light / Dark.
- A sticky save footer that appears when the form is dirty.

**Onboarding** (`features/onboarding/`)
- `WelcomePage`: the hero (`--text-display`), a three-step explainer ("Add what you know → Record or import a meeting → Review what changed") and the "Create your first project" CTA.
- `SetupChecklist`: shared with `SetupCard`.

### 4.4 Hooks and lib

- `hooks/`: `useAction` (unchanged semantics), `useEvent`, `useTick`, `useMediaQuery`, `useHotkey` (in-window shortcuts, §8.2), and `useTheme` with the Settings rebuild (Step 3). `useConfirm` and `useToast` live with their providers in `components/ui`.
- `lib/`: `clickable` (kept for the rare non-button case), `format` (re-exports `@shared/format`, `fmtDate`), `speakerColor`, `labels` (the `OP_*` and `STATUS_*` maps now duplicated across files, collected in one place).

---

## 5. Folder structure

```
src/renderer/src/
├── main.tsx                     # mounts <App/>, imports styles/index.css
├── App.tsx                      # providers (Theme, Toast, Confirm) + AppShell + view switch
├── api.ts                       # unchanged
├── env.d.ts
├── navigation.ts                # View type + useNavigation() (moved out of App.tsx)
│
├── styles/
│   ├── index.css                # @import "tailwindcss"; fontsource imports; @import the files below
│   ├── theme.css                # clears Tailwind's default scales (--color-*: initial, …); duration-* @utility classes
│   ├── tokens.css               # @theme static { light tokens } + dark overrides under prefers-color-scheme; plain :root vars
│   └── base.css                 # @layer base: body, headings, focus ring, scrollbars, reduced-motion, forced-colors
│
├── components/
│   ├── ui/                      # primitives: no api calls, no domain types; one file each, cva variants inline
│   │   ├── Button.tsx  IconButton.tsx  SplitButton.tsx  Icon.tsx  Spinner.tsx
│   │   ├── Badge.tsx  Avatar.tsx  Kbd.tsx  Timestamp.tsx  Stat.tsx  Divider.tsx  VisuallyHidden.tsx
│   │   ├── Input.tsx            # Input, SecretInput, Textarea, Select
│   │   ├── Field.tsx  Checkbox.tsx  Switch.tsx  RadioCardGroup.tsx
│   │   ├── Tabs.tsx             # Tabs, SegmentedControl
│   │   ├── Card.tsx  Banner.tsx  EmptyState.tsx  Skeleton.tsx  ProgressBar.tsx
│   │   ├── Dialog.tsx  ConfirmDialog.tsx (ConfirmProvider + useConfirm)
│   │   ├── Menu.tsx  Tooltip.tsx  Toast.tsx (ToastProvider + useToast)
│   │   └── index.ts             # barrel
│   ├── domain/                  # thin wrappers mapping domain values → primitives
│   │   ├── badges.tsx           # ItemTypeBadge, OpBadge, MeetingStatusBadge, ItemStatusBadge, ImpactBadge
│   │   ├── SpeakerAvatar.tsx
│   │   └── index.ts
│   └── layout/
│       ├── AppShell/  Sidebar/  TopBar/  Breadcrumbs/
│       ├── PageHeader/  Toolbar/  SplitPane/  ScrollPane/
│       └── index.ts
│
├── features/                    # domain UI: may call api, owns its data loading
│   ├── projects/   board/   meetings/   meeting/
│   ├── recording/               # useRecordingController, RecordingPill, StartRecordingDialog, recorder.ts
│   ├── stakeholders/   history/   settings/   onboarding/
│
├── pages/                       # one per View; compose layout + features, no styling of their own
│   ├── WelcomePage.tsx
│   ├── ProjectPage.tsx          # PageHeader + Tabs → board | meetings | stakeholders | history
│   ├── MeetingPage.tsx
│   └── SettingsPage.tsx
│
├── hooks/                       # useAction, useEvent, useTick, useMediaQuery, useHotkey
└── lib/                         # cn (clsx + tailwind-merge), clickable, format, hues (toneVars), roving (arrow keys), speakerColor, labels (+ icons)
```

**Dependency rules** (written down now; they could be enforced later with Biome `noRestrictedImports`):
- `components/ui` imports nothing from `features`, `pages`, `api` or `@shared/types`.
- `components/domain` may import `@shared/types` and `ui`, but not `api`.
- `features/*` may import `ui`, `domain`, `layout`, `hooks`, `lib` and `api`, but never another feature's internals. If two features need something, it moves into `domain` or `lib`.
- `pages/*` compose features and own no data fetching beyond the route params.

### 5.1 Styling: Tailwind CSS v4

**Decision:** Tailwind CSS v4 with the design tokens from §2, and `class-variance-authority` for component variants. This is the common enterprise React stack (as in shadcn/ui), and it is feasible here: `@tailwindcss/vite` 4.3 supports Vite 5–8, so it works with the Vite 7 that electron-vite 5 requires.

**New dependencies** (devDependencies, since everything is bundled at build time):

| Package | Purpose |
|---|---|
| `tailwindcss`, `@tailwindcss/vite` | Utility CSS, compiled at build time |
| `class-variance-authority` | Typed variant definitions |
| `clsx`, `tailwind-merge` | `cn()`: conditional classes, with later utilities overriding earlier ones |
| `lucide-react` | Icons |
| `@fontsource-variable/geist`, `@fontsource-variable/geist-mono` | Bundled fonts |

None has an install script, so npm 11's install-script blocking (see CLAUDE.md) doesn't affect them. Pin exact minor ranges as the rest of `package.json` does.

**Setup:**
- `electron.vite.config.ts`: add `tailwindcss()` to `renderer.plugins` next to `react()`. Main and preload are untouched.
- `main.tsx` imports `styles/index.css` once. Tailwind v4 needs no `tailwind.config.js` or PostCSS config: content detection is automatic, and configuration lives in CSS (`@theme`).
- **CSP:** Tailwind outputs one static stylesheet, which `style-src 'self'` already allows. Dynamic values (a speaker's colour, a progress percentage) use CSS variables set through the `style` prop (`style={{ '--speaker': … }}`), which the existing `'unsafe-inline'` permits.
- **Vitest:** jsdom tests don't need the CSS. Class names are only strings there, and tests query by role, not by class.

**Biome:**
- Enable `css.parser.tailwindDirectives: true` so Biome parses `@theme`, `@apply`, `@variant` and `@custom-variant` instead of reporting them as errors.
- Enable the `nursery/useSortedClasses` rule (with `cn` and `cva` listed as functions) so class order is consistent and diffs are small, as Prettier's Tailwind plugin does elsewhere. It is a nursery rule, so if it proves noisy we keep it as a warning.
- The existing CSS formatter stays disabled for the old hand-compacted `styles.css` only. New CSS files are formatted.

**Rules for writing classes:**
1. Only semantic token utilities: `bg-surface`, `text-fg-secondary`, `border-line`, `rounded-xl`, `shadow-xs`, `text-title`. Arbitrary values (`w-[37px]`, `bg-[#fff]`) need a comment explaining why. Raw palette classes don't exist (`--color-*: initial`).
2. Dark mode is automatic through the tokens, so `dark:` utilities should be rare: only when a component needs a *structurally* different dark treatment.
3. Variants belong in `cva`, not in ternaries inside JSX.
4. `@apply` is used only in `base.css` (for element defaults such as `body` and `:focus-visible`), never to rebuild a component as a CSS class.
5. Motion uses the §2.9 tokens and the `motion-safe:` / `motion-reduce:` variants. The easings are Tailwind `--ease-*` theme variables (`ease-out`, `ease-in`, `ease-standard`). Tailwind has no duration theme namespace, so `theme.css` defines four small `@utility` classes (`duration-instant`, `duration-fast`, `duration-base`, `duration-slow`) that read `--dur-*`.
6. Responsive classes use our breakpoints, redefined in `@theme` as `--breakpoint-regular: 1100px` and `--breakpoint-wide: 1440px`. Compact (900–1099 px, the window's minimum) is the unprefixed default. Tailwind's defaults (`sm`, `md`, `lg`…) are removed so nobody uses phone-oriented breakpoints by accident.

**Example:**

```ts
// components/ui/Button/button.variants.ts
export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-md text-body-strong whitespace-nowrap transition-colors duration-fast ' +
    'focus-visible:shadow-focus disabled:cursor-not-allowed disabled:bg-disabled disabled:text-fg-disabled active:translate-y-px',
  {
    variants: {
      variant: {
        primary: 'bg-accent text-fg-inverse hover:bg-accent-hover',
        secondary: 'border border-line-strong bg-surface text-fg shadow-xs hover:bg-hover',
        soft: 'bg-accent-soft text-accent-fg hover:bg-accent-soft/80',
        ghost: 'text-fg hover:bg-selected',
        danger: 'border border-danger-line bg-surface text-danger-fg hover:bg-danger-soft',
        'danger-soft': 'bg-danger-soft text-danger-fg hover:bg-danger-soft/70',
        record: 'bg-record-solid text-white hover:bg-record-solid/90'
      },
      size: { sm: 'h-8 px-3', md: 'h-9 px-3.5', lg: 'h-10 px-4' }
    },
    defaultVariants: { variant: 'secondary', size: 'md' }
  }
)
```

---

## 6. Screen-by-screen plan

Each screen lists its route (the existing `View` union, unchanged), components and Figma mapping.

### 6.1 Welcome (`{ kind: 'home' }`, no projects yet)
- **Layout:** AppShell (Sidebar with an empty Projects section and an "Add project" ghost row) and a centred `WelcomePage`.
- **Content:**
  - Brand mark and a `--text-display` headline: "See what changed in your project, meeting by meeting."
  - A three-step explainer with icons.
  - Primary lg "Create your first project".
  - `SetupChecklist` below it: AI model key ☐, Speech-to-text ☐, Your name ☐. Each item links to its Settings section.
- **Figma:** the cover's "Explore MeetMind" and "Personal Assistant" cards become the three step cards. The sidebar's upgrade card becomes the `SetupCard`.

### 6.2 Project › State board (`{ kind: 'project', tab: 'board' }`, the default)
- **Header:** `PageHeader` with the project name, the description (2-line clamp with "More"), and actions: secondary "Edit project" and `CaptureMenu` (which also stays in the TopBar).
- **Then:** `ProjectSummaryStrip` (3 `Stat` cards), then `Tabs` (State · Meetings · Stakeholders · History), each with a count.
- **Toolbar:** the "N open items" explainer on the left; a "Show done & superseded" `Switch` on the right.
- **Body:** `StateBoard` → 6 `BoardColumn`s → `ItemCard`s. Clicking a card or "+" opens the `ItemDialog` popup.
- **Loading:** `Skeleton.Card` × 2 per column.
- **Empty column:** a one-line hint ("No decisions yet") plus "+ Add". When the whole board is empty, a single `EmptyState` above the columns: "Add what you already know, or record a meeting to start."
- **Figma:** the stat cards from the dashboard thumbnail (`$124,500 · $38,200…` row) become the summary strip. The kit's Tab Menu becomes the tabs. Its card style (white, hairline, 12 px radius) is used for the columns.

### 6.3 Project › Meetings
- **Toolbar:** count on the left; `CaptureMenu` on the right (Record · Paste transcript · Import transcript file · Import recording). Import progress shows as a `loading` button plus a toast when it finishes.
- **Body:** `MeetingTable`. A row with `analyzed` status shows a warning "Needs review" badge and sorts to the top of a "Needs your review" group. A row with an error shows a danger icon whose tooltip is `meeting.error`.
- **Empty:** `EmptyState` (mic icon) with "Record meeting" and "Import transcript".
- **Figma:** the meetings table thumbnail (title, date, participants, status badge, row actions) becomes `MeetingTable`. We drop pagination and participant avatars, since we have no participant data per meeting.

### 6.4 Project › Stakeholders
- **Body:** a reading column with an intro line, `AddStakeholderForm` and `StakeholderTable`.
- **Empty:** `EmptyState` saying stakeholders improve attribution, with focus moved to the Name input.
- **Figma:** the Table Component and Avatar.

### 6.5 Project › Change history
- **Body:** a reading column with `HistoryTimeline`. Date groups ("Today", "Oct 3") contain `VersionCard`s. Each card links to its meeting.
- **Empty:** `EmptyState`: "No approved changes yet. Analyze a meeting and apply its report."
- **Figma:** the activity and recent-meetings list styling.

### 6.6 Meeting (`{ kind: 'meeting' }`): the core screen

```
PageHeader: ← Meetings   Weekly sync ✎        [Map speakers] [Analyze impact] [⋯]
            Oct 8, 10:02 · Teams · 214 lines · ◉ Needs review
PipelineStepper: ● Captured ─ ● Transcribed ─ ● Analyzed ─ ◐ Reviewed ─ ○ Applied
[Banner: meeting error / skipped changes]
┌ Transcript (5) ─────────────┐ ┌ Impact report (7) ──────────────────────────┐
│ [All] [Priya] [Rahul] [You] │ │ ReportSummary                               │
│ 00:12  (P) Priya            │ │ ▾ Conflict with project state (1)           │
│        We need SSO for …    │ │   ProposalCard                              │
│ 00:31  (R) Rahul            │ │ ▾ Timeline change (2)                       │
│        Let's push launch …  │ │   ProposalCard  ProposalCard                │
│ …                            │ │ …                                           │
│                              │ ├─────────────────────────────────────────────┤
│                              │ │ ReviewBar ▓▓▓▓▓░░ 5/7  [Accept all firm] [Apply 4 changes] │
└──────────────────────────────┘ └─────────────────────────────────────────────┘
```

**ProposalCard anatomy:**

```
┌─▌ [CHANGE] [Deadline]  Launch moves to Nov 20            [High] 92% ─┐
│   Existing: Launch  · due ~~Nov 1~~ → Nov 20                         │
│   Body text…                                                         │
│   (R) Rahul · owner Priya · due Nov 20          tentative?          │
│   ┃ "Let us push the launch to November 20."  — Rahul · 00:31  ↗    │
│   Rationale (secondary text, collapsible if > 2 lines)               │
│   [✓ Accept]  [Edit]  [✕ Reject]                                     │
└──────────────────────────────────────────────────────────────────────┘
```

- The left rail colour shows the status: neutral = pending, success = accepted, danger = rejected (the card is also dimmed and its title struck through), info = applied (actions are replaced by an "Applied to project" badge).
- Accept and Reject are toggle buttons with `aria-pressed`.
- **Live state** (while recording this meeting):
  - The header badge becomes record-toned "Live" with a pulse.
  - The transcript shows "Listening… lines appear about every N seconds" with a subtle pulsing waveform icon.
  - The report pane shows `EmptyState`: "The report is generated when the meeting ends."
- **Processing** (`transcribing` / `analyzing`): the stepper's current step spins. The report pane shows `Skeleton` proposal cards and the label "Comparing this meeting with the project state…".
- **Compact width:** `SplitPane` becomes Tabs (Transcript · Impact report, with counts). Clicking an evidence quote switches to the Transcript tab and highlights the line.
- **Figma:** the meeting-detail thumbnail (transcript list beside AI notes, with a player bar) becomes the split view. The kit's "AI summary" card becomes `ReportSummary`. Badges use the kit's soft-outline style.

### 6.7 Settings (`{ kind: 'settings' }`)
- **Layout:** `PageHeader` "Settings", then `SettingsNav` (AI model · Transcription · Recording & hotkeys · Appearance) and a reading-column form. The nav scroll-spies the sections.
- **Provider choice:** `RadioCardGroup`, with a "Key saved" success badge per provider.
- **Saving:** a sticky footer appears when the form is dirty: "Unsaved changes", then [Discard] [Save changes]. "Test connection" stays inline in its section, and its result shows in a `Banner`.
- **Figma:** the Settings thumbnail (left sub-nav "General / Meeting Settings / Notifications…" plus form rows) becomes `SettingsNav` and the sections. The Integrations card grid becomes the provider `RadioCardGroup`.

### 6.8 Dialogs and overlays (all screens)

| Today | New |
|---|---|
| `NewProjectModal` | `NewProjectDialog` (md) |
| `EditProjectModal` | `EditProjectDialog` (md); delete is a danger zone and uses `ConfirmDialog` |
| `ItemModal` | `ItemDialog` (popup, lg, with the history section) |
| `StartRecordingModal` | `StartRecordingDialog` (sm) |
| `PasteTranscriptModal` | `PasteTranscriptDialog` (lg) |
| `EditProposalModal` | `EditProposalDialog` (md), primary "Save & accept" |
| `SpeakerMapModal` | `SpeakerMapDialog` (md) |
| `RenameModal` | Inline editable title in `PageHeader`; a dialog only as the fallback |
| `confirm()` × 5 | `ConfirmDialog` |
| `banner` string | `Toast`s, and the `DetectedMeetingBanner` in the BannerStack |
| Red `recbar` | `RecordingPill` in the TopBar |

---

## 7. Interaction and motion

**Principles:** motion explains a change of state or place. It is never decorative, it never delays input, and everything except the recording pulse respects `prefers-reduced-motion`.

| Interaction | Motion |
|---|---|
| Button/row hover | Background/border colour change, `--dur-fast`, `--ease-standard` |
| Button press | `translateY(0.5px)`, `--dur-instant` |
| Focus ring | Appears instantly. No animation, so it is never late. |
| Menu / tooltip / popover | Fade plus 4 px slide from the anchor, `--dur-base` `--ease-out`; exit `--dur-fast` `--ease-in` |
| Dialog | Backdrop fades; panel fades and scales `.98 → 1`, `--dur-slow` `--ease-out` |
| Toast | Slides up 8 px and fades; the stack reflows with a `--dur-base` transform |
| Tab change | Underline indicator slides to the new tab (`--dur-base`); panel content swaps without animation |
| Proposal accept | Left rail colour transitions to success and the check icon scales `0.8 → 1` (`--dur-base`). The card **does not move or reorder** (stable positions are critical in a review queue). |
| Proposal reject | Card dims to 60% opacity and the title strike-through draws, `--dur-base` |
| Apply changes | The button shows loading. On success, accepted cards change to "Applied" one after another (30 ms stagger, max 300 ms total), then a toast says "4 changes applied · View project state". |
| Evidence jump | Transcript smooth-scrolls (`block: center`). The line flashes a warning-soft background held for 1.2 s, then fades over 800 ms. Reduced motion: instant scroll and static highlight. |
| Live transcript append | New lines fade in (opacity, `--dur-base`). Auto-scroll only if the user is at the bottom; otherwise a "Jump to latest ↓" pill fades in. |
| Recording dot | Opacity pulse 1 → .35, 1.2 s, infinite. **Kept under reduced motion** at a slower 2 s, because it is a status signal: it is marked `data-essential-motion`, which `base.css` exempts from its reduced-motion reset. The "Recording" text label is always present too. |
| Mark moment | The star icon pops (scale 1 → 1.25 → 1) and a toast "Marked 12:04" appears |
| Board item saved | The changed card gets a 1 s accent-soft background fade |

**Loading and skeletons.** These rules replace today's `if (!x) return null`.
- **First load of a page:** skeletons that match the final layout. They use `--color-selected` blocks with a 1.4 s linear shimmer gradient, or a static block under reduced motion.
  - Board: column headers plus 2 card skeletons each.
  - Meetings: 5 row skeletons.
  - Meeting: header skeleton, 8 transcript-line skeletons, 3 proposal-card skeletons.
- **Refetch after `meeting:changed`:** don't skeleton. Keep the stale content and swap it in place, to avoid flicker.
- **Skeleton delay:** only show skeletons if loading takes more than 150 ms, to avoid flashing on fast local SQLite reads.
- **Long background work** (transcribing, analyzing): the `PipelineStepper` spinner plus a toast when done (main already sends a notification).
- **Button actions:** `loading` on the triggering button through `useAction().busy`. The rest of the page stays usable unless the action would conflict; for example, Apply is disabled while analyzing, as it is today.

---

## 8. Accessibility

Target: **WCAG 2.2 AA**.

### 8.1 Contrast

- **Text:** ≥ 4.5:1 for normal text and ≥ 3:1 for text ≥ 18.66 px bold / 24 px regular.
- **Non-text:** icons that carry meaning, focus rings, the selected indicator, input borders in their focus state and toggle tracks need ≥ 3:1.
- Key pairs (approximate; verified by an automated test, below):

| Pair | Ratio | Result |
|---|---|---|
| `--color-fg` `#111` on `#fff` / `#f9f9f9` | ~18.9 / ~17.9 | ✅ |
| `--color-fg-secondary` `#575757` on `#fff` | ~7.0 | ✅ |
| `--color-fg-tertiary` `#696e6e` on `#f9f9f9` | ~4.9 | ✅ |
| Kit Text/disabled `#717676` on `#f9f9f9` | ~4.4 | ❌, hence the derived gray-600 |
| White on `--color-accent` `#007e4b` | ~5.1 | ✅ |
| White on kit primary `#009d5e` | ~3.5 | ❌ for text; used for non-text only |
| `--color-focus` `#009d5e` vs `#fff` | ~3.5 | ✅ (non-text 3:1) |
| Red text `#9e2a2a` on red-soft `#f9ebeb` | ~6.9 | ✅ |
| Yellow text `#5f4314` on yellow-soft `#fff8ec` | ~8.9 | ✅ |
| Kit Badge/success `#46a983` on its shade | ~2.9 | ❌, hence the derived green text `#1f6b4e` |

- **Automated check:** add `test/renderer/contrast.test.ts`. It parses `tokens.css` for both themes and asserts a list of foreground/background pairs (every `*-fg` on its `*-soft`, `fg` tokens on `canvas`/`surface`, inverse on `accent` and the solids). A token edit that breaks AA then fails CI. *Derived* hex values in §2.1 may be nudged by this test during implementation.
- **Input borders:** at rest, `#d4d4d4` is below 3:1. This is acceptable because every field has a visible label and a filled surface. Hover and focus states meet 3:1. In Windows High Contrast (`forced-colors: active`), all borders use `CanvasText`/`Highlight`, and the custom focus ring becomes `outline: 2px solid Highlight`.
- **Colour is never the only signal:** every status and category badge has a text label; proposal state uses the rail colour plus an icon, `aria-pressed` and a text badge; due-date urgency adds "Overdue" text.

### 8.2 Keyboard navigation

- **Everything is reachable by Tab in visual order.** Clickable things are `<button>` elements; `clickable()` stays only as a last resort.
- **Skip link:** "Skip to content" is the first focusable element and jumps to `<main>`.
- **Landmarks:** `<nav aria-label="Projects">` (sidebar), `<header>` (TopBar), `<main>`, and `role="region"` with `aria-label` on the Transcript and Impact report panes.
- **Composite widgets** use WAI-ARIA patterns with roving tabindex: Tabs (←/→, Home/End), Menu (↑/↓, typeahead, Esc), RadioCardGroup (arrow keys), SegmentedControl.
- **Dialogs:** native `<dialog>` modal focus containment. Initial focus goes to the first field (or Cancel for destructive confirms). Esc closes unless saving. Focus returns to the trigger.
- **In-app shortcuts** (`useHotkey`). They are inactive while typing in an input or a dialog is open, and listed in a "Keyboard shortcuts" dialog opened with `?`.

  | Key | Action |
  |---|---|
  | `J` / `K` | Next / previous proposal (Impact report) |
  | `A` / `R` / `E` | Accept / reject / edit the focused proposal |
  | `T` | Jump to the evidence of the focused proposal |
  | `N` | New item (board) |
  | `Ctrl+,` | Settings |

  Global hotkeys (record, mark) stay as they are, configured in main.

### 8.3 Focus styles

- One ring everywhere: `box-shadow: var(--shadow-focus)`, which is a 2 px surface gap and then a 2 px `--color-focus` ring, applied on `:focus-visible` only.
- Inside tight containers, such as a full-width transcript line, use an inset version (`inset 0 0 0 2px var(--color-focus)`).
- Never `outline: none` without a replacement. `base.css` sets `:focus:not(:focus-visible) { outline: none }`, and that is the only removal.
- Focus must never be obscured by the sticky `ReviewBar` or TopBar (WCAG 2.2 SC 2.4.11). The scroll containers use `scroll-padding-bottom` equal to the ReviewBar height.

### 8.4 Screen readers and semantics

- Live regions:
  - The toast region is `role="status"` (errors use `role="alert"`).
  - The recording timer is *not* live, which would be too chatty. Only start and stop are announced.
  - New transcript lines are not announced. The "Jump to latest" pill is announced politely.
- `aria-busy` on regions that are loading. Spinners have labels ("Analyzing meeting").
- Buttons with only icons always have `aria-label`. Toggle buttons use `aria-pressed`. The active nav item uses `aria-current="page"`.
- Evidence quotes are buttons labelled "Show in transcript: ‘…quote…’, Rahul at 0:31".
- **Target size:** the minimum is 24×24 px (WCAG 2.2 SC 2.5.8); the default control is 36 px and the smallest is 32 px.
- Text resizes to 200% without loss (rem-based type; layouts reflow rather than clip).

---

## 9. Migration plan

**Goal:** replace the UI incrementally. **After every step:**
- `npm run typecheck`, `npm test` and `npm run check` pass.
- The app runs (`npm run dev`, or against throwaway data with `--user-data-dir`).
- Recording, analysis and apply still work end to end.

Each step is one PR on its own branch.

**Test strategy throughout:**
- Renderer tests currently find elements by text and `.modal`, for example `'✓ Accept'`. When the matching component is replaced, they move to role-based queries: `getByRole('dialog')`, `getByRole('button', { name: 'Accept' })`. That makes them robust to the redesign.
- Behaviour assertions (errors shown, input kept on failure, no double submit) must not change.
- New primitives get focused tests (Dialog focus return, Tabs keyboard, Button loading/disabled, ConfirmDialog resolution).

**Step 0. Foundations: Tailwind, tokens, fonts and the theme setting** (no change to component structure)
1. Install the §5.1 dependencies. Add `tailwindcss()` to the renderer plugins. Add `styles/index.css`, `tokens.css`, `theme.css` and `base.css`, and import them from `main.tsx`. Turn on Biome's `tailwindDirectives`.
2. **Coexistence with the old CSS:**
   - Tailwind puts its preflight reset and its utilities in cascade layers (`@layer base`, `@layer utilities`).
   - The legacy `styles.css` stays **unlayered**, and unlayered CSS always beats layered CSS. Old screens therefore keep their look exactly, and preflight can't break them.
   - New components use only utilities, never the old classes, so the two don't interfere.
3. **Re-point the legacy variables** in `styles.css` (`--bg`, `--panel`, `--accent`…) at the new semantic tokens, and set the body font to Geist. The existing UI immediately picks up the new palette, font and light/dark support with no JSX changes.
4. **Theme setting (System, the default; Light; Dark):**
   - Add `theme: 'system' | 'light' | 'dark'` to `Settings` in `src/shared/types.ts`, defaulting to `'system'`.
   - Add `theme: z.enum(['system', 'light', 'dark'])` to `SETTINGS_FIELDS` in `ipc.ts`. An existing `settings.json` without the key falls back to the default, because unknown or invalid values already do.
   - In `index.ts`, apply `nativeTheme.themeSource` at startup and whenever settings are saved, and create the `BrowserWindow` with `backgroundColor` matching `nativeTheme.shouldUseDarkColors` (no launch flash).
   - Extend `settings.test.ts` (default value, invalid value falls back) and add a small test that saving the setting updates `themeSource`.
   - Until the Settings page is rebuilt in Step 3, the old Settings view gets a temporary three-option select for the theme.
5. Add `contrast.test.ts`.

*Risk:* low. These are the only main-process and shared-type edits in the whole migration. *Checkpoint:* the app looks restyled in both themes, switching Windows between light and dark updates it live under "System", and everything still works.

**Step 1. Primitives library**
- Build `components/ui` and `components/domain`, plus the `hooks/` and `lib/` moves: `useAction`, `useEvent` and `useTick` move unchanged, and `ui.tsx` re-exports from the new locations so existing imports keep working.
- Add tests per primitive.
- Not yet used by any screen, except swapping `Modal` → `Dialog` behind the same `Modal` API, so all existing dialogs gain focus trapping now.

*Risk:* low.

**Step 2. App shell and recording extraction**
1. Extract `useRecordingController` out of `App.tsx` **with no behaviour change**. Add a renderer test for start → stop → navigate-to-meeting with a fake recorder, run before and after the extraction.
2. Introduce `AppShell`, `Sidebar` (with the rail), `TopBar` (`CaptureMenu`, `RecordingPill`), `BannerStack`, `ToastRegion` and `ConfirmProvider`. Replace the `banner` string with toasts.
3. The old page components render unchanged inside the new shell.

*As built:* the paste/import actions moved into `features/meetings/capture.tsx` (`useCaptureActions`) so the Capture menu and the Meetings tab share them, and the New project and Start recording dialogs were rebuilt on the primitives. The project page keeps its old Record button and import buttons until Step 4. `test/renderer/recording.test.tsx` pins the recording flow; `shell.test.tsx` covers the sidebar, rail, breadcrumbs and Capture.

*Risk:* medium, because recording state is the riskiest logic. *Checkpoint:* a manual recording with Teams/Zoom (detect → record → mark → stop → transcribe → analyze), plus a quit-while-recording check.

**Step 3. Settings page**
- Rebuild it as `SettingsPage` with sections, `RadioCardGroup`, `SecretInput`, the sticky save footer and and the Appearance section: a System / Light / Dark `SegmentedControl` bound to the `theme` setting from Step 0. The temporary select is removed.

*Risk:* low. It's self-contained, and `settings.test`/`views.test` cover it.

*As built:* `pages/SettingsPage` with sections in `features/settings/`. The theme saves itself through `useTheme` the moment it's picked, so the Save button leaves `theme` out and can't overwrite it. Fields are checked with the same rules as `SETTINGS_FIELDS` before saving. `SettingsView.tsx` stays as a one-line re-export so this step doesn't touch `App.tsx`; Step 7 removes it. Tests: `settingsPage.test.tsx`.

**Step 4. Project pages**, one sub-step per tab, in this order:
1. `ProjectPage` with `PageHeader`, `Tabs`, `ProjectSummaryStrip`, and `EditProjectDialog` using `ConfirmDialog`.
2. History: read-only, so the lowest risk.
3. Stakeholders.
4. Meetings: `MeetingTable` and the `CaptureMenu` import actions.
5. State board: `StateBoard`, `ItemCard`, `ItemDialog` (replacing `ItemModal`).

After each sub-step, delete the matching function from `ProjectView.tsx`. When it is empty, delete the file.

*As built:* `pages/ProjectPage` with `useProjectData`, which loads the project's items, meetings, stakeholders and versions once (so tab counts and the summary strip agree) and reloads them on `meeting:changed`. The tabs live in `features/board`, `features/meetings` (`MeetingsPanel`), `features/stakeholders` and `features/history`; `FieldDiff` is a domain component shared with the meeting page. Item and project deletes use `useConfirm`. The header's old Record button is gone, since recording lives in the top bar. `ProjectView.tsx` was deleted in one go rather than function by function. Tests: `projectPage.test.tsx`.

**Step 5. Meeting page**, the most important and the most complex screen. In this order:
1. `MeetingHeader`, `PipelineStepper` and the banners.
2. `TranscriptPane` / `TranscriptLine`, including live append and the "Jump to latest" pill.
3. `ImpactReport`, `ReportSummary`, `ProposalGroup`, `ProposalCard`, `EvidenceQuote` and `FieldDiff`.
4. `ReviewBar`, keeping the "Accept all firm" exclusion of close/supersede, with a test asserting it.
5. The dialogs, and `SplitPane` compact tabs.
6. Proposal keyboard shortcuts.

`test/pipeline.test.ts` doesn't touch the renderer. The `views.test.tsx` meeting cases are updated to role queries in the same PR. *Checkpoint:* analyze → accept/edit/reject → apply → skipped-changes path, on a seeded database.

*As built:* `pages/MeetingPage` with `features/meeting/` (`useMeetingData`, `PipelineStepper`, `TranscriptPane`, `ImpactReport` with the review bar, `ProposalCard`, `EvidenceQuote`, dialogs). The "Accept all firm" rule is the pure `firmProposals()`. Delete and re-analyze confirm with `useConfirm`; Delete and Rename sit in a "More actions" menu, and the title is also a rename button. An update proposal's card shows its title, due and owner changes as `FieldDiff`s. Tests: `meetingPage.test.tsx`, checked end to end in the app on a seeded report (keyboard review, evidence jump, apply).

**Step 6. Welcome and onboarding**
- `WelcomePage` and `SetupChecklist`/`SetupCard`.

**Step 7. Cleanup and audit**
- Delete `styles.css`, the legacy variables, `ui.tsx` re-exports, `.text-btn` and the other old classes. Re-enable Biome's CSS formatter for all files, and drop the "hand-compacted styles.css" exception from `biome.jsonc`.
- Check for stray arbitrary values (`-[`) and `dark:` overrides, and justify or remove each.
- Grep for `window.confirm`, `title=` used as the only explanation, and hard-coded colours. Add Biome `noRestrictedImports` for the folder rules.
- Run an accessibility pass: keyboard-only walk-through of every screen, Windows Narrator smoke test, forced-colors check, both themes at 900 px and 1440 px.
- Update `CLAUDE.md`'s "Renderer conventions" for the new structure (Tailwind + `cva` rules, Button/Dialog/useConfirm/useToast, folder rules, the `theme` setting).

**Later (not part of this migration):**
- A quick switcher (`Ctrl+K`), inspired by the kit's search field. It needs a cross-project meetings query.
- A cross-project "Needs review" inbox on Home.
- An audio player in the transcript pane, which would need an api to stream the `.webm`.

---

## 10. Decisions

Agreed in review on 2026-10-08:

1. **Theme:** System (default), Light and Dark, stored as the `theme` setting and applied through `nativeTheme.themeSource` (§2, Step 0).
2. **Icons and fonts:** `lucide-react`, and Geist / Geist Mono through `@fontsource-variable` (§2.3, §4.1).
3. **Project sections** are page tabs (State · Meetings · Stakeholders · History), not sidebar sub-items (§3, §6.2).
4. **Editing an item** opens a popup dialog (`ItemDialog`) with the history inside it, not a side drawer (§4.3).
5. **Styling:** Tailwind CSS v4 with `class-variance-authority`, `clsx` and `tailwind-merge`, on top of the token layer (§5.1).
6. **Main-process changes:** approved, and limited to the theme setting and the window background colour (Step 0).
