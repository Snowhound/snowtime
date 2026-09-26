# 01: Folder structure

Status: todo

A folder holding many unrelated files makes a change hard to scope. `src/lib/` has about
35 files that range from scene and weather code to session, members, and form helpers.

## Acceptance criteria

- [ ] No folder in `src/` mixes several unrelated concerns; related files that only
      share a folder move into a subfolder (for example the scene, weather, seasons,
      and intro files in `src/lib/` and `src/components/`)
- [ ] Code in `src/lib/` or `src/components/` that only one feature uses moves into that
      feature, as `AGENTS.md` requires
- [ ] Moves go in their own commit, listed in `.git-blame-ignore-revs`

## Findings
