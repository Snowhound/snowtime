# 03: In-app marks without tiles

Status: todo

The app icons sit on a rounded navy or ice tile. That suits favicons and home-screen icons, but in
the app header, the picker, the Settings preview, and the sign-in card, the tile reads as a box
around the logo. Use the bare mark inside the app, and keep the tiled icons for favicons and app
icons.

Only concept `02` has bare marks today (`design/brand-assets/marks/`, light and dark). The
lockups show the other concepts bare, but the navy-tile concepts' marks are pale and vanish on a
light page.

## Acceptance criteria

- [ ] `build.py` exports a bare mark for every concept, in a light-page and a dark-page version
      (`marks/NN-name-light.svg`, `-dark.svg`). Pale marks get a light-page version in brand
      colors that meets 3:1 against the light background, as `02`'s does.
- [ ] Marks that need it get a small version for 20 to 28 px, like the small icons, and are
      checked at those sizes.
- [ ] The header, the app icon picker, the Settings preview, and the sign-in card show the bare
      mark for the page's theme. The favicon and the picker's tab preview keep the tiled icon.
- [ ] The picker still groups concepts so a user can tell what the favicon will look like, for
      example with the tiled icon as a small badge beside the mark.
- [ ] `prototypes/README.md` and `design/brand-assets/README.md` record which exports the app
      and the favicon use.
