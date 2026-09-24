import * as v from 'valibot'
import { Uuidv7 } from './common'

export const ProjectName = v.pipe(
  v.string(),
  v.trim(),
  v.minLength(1, 'Enter a name.'),
  v.maxLength(100),
)

// A hex color such as #4E79A7; null removes it.
export const ProjectColor = v.nullable(
  v.pipe(v.string(), v.regex(/^#[\da-f]{6}$/i, 'Use a color like #4E79A7.')),
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
