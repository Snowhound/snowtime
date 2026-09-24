# 04: Tagline, tone, and season choice

Status: in-progress

Decide the variants the prototype bar still compares, then remove the rest. The split layout is
already rejected: the card layout is the sign-in page.

## Acceptance criteria

- [x] The split layout is gone from `auth.html`: the layout toggle, the brand panel and its
      styles, and the scene's panel placement in `placeScene`. `prototypes/README.md` records
      the card layout as the only one.

- [x] A tagline treatment over the scene is chosen: halo, in the card, bottom fade, or pill, or
      dropping the tagline while the background is on. Chosen: bottom fade, on every page. The
      other treatments stay in the prototype bar until the variants are pruned.
- [ ] A page tone is chosen, deeper or the app's, and either folded into the brand tokens (task 029) or kept to the sign-in page.
- [ ] How the app picks the season is decided, for example by month, flipped for the southern
      hemisphere from the user's time zone. The prototypes have a Season setting in the Scenery
      menu and Settings: Auto (by month, northern hemisphere) or one of the four.
