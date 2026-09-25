# 06: Projects

Status: done

Project list and management for admins and owners, read-only for others. Prototype:
`prototypes/projects.html`.

## Acceptance criteria

- [x] List from `listProjects` with color, name, teams, and time this month from
      `getReport`, sorted by name, with Active and Archived tabs and a name search
- [x] Members and team leads see their projects, their own time, and no actions
- [x] Create and edit dialog: name, color swatches, and teams, saved through
      `createProject` or `updateProject` and then `assignProjectToTeam` and
      `unassignProjectFromTeam` for the changed teams; a new project gets the least used
      color
- [x] A name clash with an archived project suggests restoring it
- [x] Archive (confirmed) and restore (`archiveProject`, `unarchiveProject`)
- [x] Delete (`deleteProject`), offering "Archive instead" on `CONFLICT`
- [x] Empty organization state linking to Organization
