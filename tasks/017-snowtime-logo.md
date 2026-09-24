# 017: Snowtime logo as a hand-built SVG

Status: todo

The prototypes use `prototypes/assets/snowhound-wolf.svg`, traced from the 300 px
Snowhound site icon (`sh-pea-300x300.png`); its edges are uneven. The wolf head is made of
flat triangles, so build it from scratch as polygons in a separate session.

## Acceptance criteria

- [ ] SVG built from polygons with the icon's four colors (`#d6dce4`, `#c2c8d0`,
      `#aab2bc`, `#232323`), under 3 KB
- [ ] Legible at 16, 32, and 180 px, on light and dark backgrounds
- [ ] Replaces `prototypes/assets/snowhound-wolf.svg`; favicon and app icons exported
- [ ] Logo and tagline come from deployment config, not code, so a dedicated client stack
      can rebrand (`docs/architecture.md`, "Deployment model")
