# 020: Delete project

Status: todo

Projects are CRUD in the MVP (`docs/product.md`), but task 006 added no delete. Delete
is for projects created by mistake: a project with time on it is archived instead, so no
entry ever loses its project.

## Acceptance criteria

- [ ] `deleteProject` (admin/owner) sets `sys_deleted`; its team assignments are removed
- [ ] A project with live time entries returns `CONFLICT`, telling the admin to archive it
- [ ] The freed name can be reused (`project_organization_id_name_unique` is partial)
- [ ] Tested on a seeded throwaway database
