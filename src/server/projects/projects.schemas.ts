import * as v from 'valibot'
import { m } from '~/paraglide/messages.js'
import { Timestamp, Uuidv7 } from '../schemas'

export const ProjectName = v.pipe(
  v.string(),
  v.trim(),
  v.minLength(1, () => m.validation_name_required()),
  v.maxLength(100, (issue) => m.validation_too_long({ max: issue.requirement })),
)

// A hex color such as #4E79A7; null removes it.
const ProjectColor = v.nullable(
  v.pipe(
    v.string(),
    v.regex(/^#[\da-f]{6}$/i, () => m.validation_color_format()),
  ),
)

export const CreateProjectInput = v.object({
  id: Uuidv7,
  name: ProjectName,
  color: v.optional(ProjectColor, null),
})
export type CreateProjectInput = v.InferOutput<typeof CreateProjectInput>

// Only the fields present change.
export const UpdateProjectInput = v.object({
  id: Uuidv7,
  name: v.optional(ProjectName),
  color: v.optional(ProjectColor),
})
export type UpdateProjectInput = v.InferOutput<typeof UpdateProjectInput>

export const ProjectIdInput = v.object({ id: Uuidv7 })
export type ProjectIdInput = v.InferOutput<typeof ProjectIdInput>

export const ProjectTeamInput = v.object({ projectId: Uuidv7, teamId: Uuidv7 })
export type ProjectTeamInput = v.InferOutput<typeof ProjectTeamInput>

// The timer and entry forms list active projects; project management also archived ones.
export const ListProjectsInput = v.optional(
  v.object({ includeArchived: v.optional(v.boolean(), false) }),
  {},
)
export type ListProjectsInput = v.InferOutput<typeof ListProjectsInput>

// A project as the API sends it.
export const Project = v.object({
  id: v.string(),
  name: v.string(),
  color: v.nullable(v.string()),
  archivedAt: v.nullable(Timestamp),
})

// A listed project also has the ids of the teams it is assigned to, and whether it has
// entries, which deleteProject refuses.
export const ListedProject = v.object({
  ...Project.entries,
  teamIds: v.array(v.string()),
  hasEntries: v.boolean(),
})
export type ListedProject = v.InferOutput<typeof ListedProject>
