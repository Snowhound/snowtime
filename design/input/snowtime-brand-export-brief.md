# Snowtime brand asset pack — implementation brief for Codex

You are working in the Snowtime project repository. Replace the temporary branding with a production-ready set of **clean, manually constructed SVG assets**, theme tokens, favicon exports, and an icon-selection implementation appropriate to the existing app. Complete the work in the repository and show me the results. I will provide the original concept board and the later browser-tab/favicon board as image attachments (or local files); inspect both before drawing anything.

## Source of truth

- **Original concept board:** use for the full-sized icon designs, concept numbers, proportions, and the original **`Snowtime`** capitalization and wordmark. The preferred name is `Snowtime`, **not** `SnowTime`.
- **Later favicon/browser-tab board:** use **only** for the smaller/simplified icon variants and as the reference for how they look at tab size. Its large artwork or alternate wordmark must not override the original board.
- The **default icon is concept `02`**. Users should be able to select any of the concept icons shown on the original board. Preserve the numbering in the boards; determine the actual count from the images rather than inventing missing concepts.
- The default favicon, and the favicon for _each_ selectable concept, must be derived from the **small icon variant on the later board**, especially for `02`. Do not shrink the original large icon and call that the favicon. If a small variant is unclear, redraw a deliberate simplified version consistent with the board.
- Snowhound (https://snowhound.eu/) is the parent brand. Inspect the existing repository theme and any provided brand references to derive the light and dark colors. Do not fabricate supposedly exact brand hex values from an image; document approximations and their provenance. Retain any compatible existing design tokens.
- The images are visual references, not editable source files. Do **not** auto-trace the PNG or embed raster artwork in the SVG. Reconstruct consistent geometry with compact SVG primitives and intentional paths; acknowledge where interpretation was necessary.

## Work sequence

1. Inspect the repository conventions, current logo, theme system, framework, favicon handling, user settings, and the two images. Identify each concept by the board's number and create a short mapping of visual motif to asset filename. If the reference images are inaccessible, ask for them before attempting visual reconstruction.
2. Recreate **every original-board concept** as an icon-only SVG at normal UI sizes. Draw a separately optimized `small` SVG for each using the later board. Maintain consistent viewBoxes, proportions, optical centering, and clear silhouettes; keep paths simple and avoid filters or unnecessary gradients. Include the original-style `Snowtime` wordmark and useful horizontal icon + wordmark lockups. If exact lettering cannot be reproduced cleanly, use an appropriately licensed font converted to outlines for standalone SVG and record the font/license.
3. Use `02` as the default and export its ready-to-use favicon/app set from its **small SVG**: `favicon.svg`, 16×16 and 32×32 PNG, Apple touch icon (180×180), and 192×192 and 512×512 app icons. Include a web manifest if this app uses one. Keep foreground padding and backgrounds intentional at every size. For the other concepts, make equivalent small SVG favicon sources and at least 16×16 and 32×32 PNGs so selection can update browser tabs. Add other size exports for every concept only if needed by the existing app.
4. Create light/dark theme tokens (CSS variables and/or the repo's existing token format), with the brand palette and accessible foreground/background pairings. SVGs should be themeable where they appear in the UI (for example via `currentColor` or appropriate light/dark variants); favicon files need explicit colors where browsers cannot inherit CSS. Avoid relying on browser theme changes to recolor an external SVG unless verified.
5. Integrate an icon chooser with the app's existing settings/state conventions. Persist each user's choice in the appropriate user settings mechanism; use the established server store if it exists, otherwise a clearly scoped local preference. Default to `02` when unset or invalid. Update the displayed app icon and active browser-tab favicon when selection changes; restore them on reload. Preserve the app's current routing and theme behavior. Do not assume that changing a PWA manifest dynamically updates an already installed home-screen icon; document this distinction.
6. Make a compact visual review sheet showing all normal icons, their small variants, `Snowtime` lockups, and browser-tab previews on light and dark browser chrome. Include the concept numbers. Render real SVG/PNG outputs for review rather than reusing the reference bitmap.
7. Verify that all SVGs parse; inspect exported images at **16, 20, 24, 32, and 64 px** at actual displayed size. Check `02` particularly carefully. Inspect light and dark UI, selection persistence, favicon switching, and relevant existing tests/build commands. Correct any icons whose detail disappears or fills in at 16 px. Summarize test results and any unavoidable visual differences from the generated boards.

## Suggested deliverables (adapt paths to this repository)

```text
public/brand/
  wordmark.svg
  lockups/
    01.svg ...
  icons/
    01.svg ...
    02.svg                   # default full-size icon
  icons-small/
    01.svg ...
    02.svg                   # source of default favicon
  favicon/
    favicon.svg
    favicon-16x16.png
    favicon-32x32.png
    apple-touch-icon.png
    icon-192.png
    icon-512.png
    variants/                # per-concept tab icons
  site.webmanifest           # if applicable
src/lib/                     # use existing structure instead if different
  snowtime-icons.ts          # typed concept registry and default '02'
  snowtime-theme.css         # or integrate into existing tokens
brand-review/                # contact sheet and concise mapping/notes
```

Choose descriptive names **after inspecting the boards**. Avoid overwriting unrelated existing app assets without checking references. The naming above is illustrative; working integration and consistent references matter more than matching these paths.

## Acceptance criteria

- Every numbered concept from the original board has a clean SVG and a separately optimized small SVG.
- `Snowtime` appears with the **original capitalization** in all wordmarks and lockups.
- `02` is the default everywhere; its tab icon clearly matches the _small_ board version.
- All concepts are selectable by users, the choice persists, and the browser-tab icon changes with it.
- The default favicon/app icon exports and the per-concept browser-tab exports use small-variant artwork; light/dark colors are coherent with Snowhound and the app.
- All export files are valid, correctly sized, legible at 16 px, and documented with a contact sheet and any font/color sourcing notes.

Proceed with implementation and visual QA; make reasonable repo-specific choices autonomously. If the two reference boards differ, follow the source-of-truth rules above and flag only genuinely unresolved visual ambiguities in your final summary.
