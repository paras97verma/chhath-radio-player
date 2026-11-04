# Project handoff

For playback work, read [`RESUME.md`](RESUME.md) first. The canonical task checklist is [`specs/001-resilient-stream-playback/tasks.md`](specs/001-resilient-stream-playback/tasks.md); keep completion status there and do not duplicate checkboxes. Use one writing session per checkout; stop the previous writer before another session edits it.

Before editing a task, record its ID, last completed step, and exact next action in `RESUME.md`. After each coherent file group and before and after long test/build commands, record changed files, completed work, actual command/results, and next action. Mark a task `[x]` only after its criteria and required validation are complete; interrupted or blocked tasks stay open.

On resume, inspect `git status --short`, staged and unstaged diffs, and the task's relevant files, including untracked files. Reconcile `RESUME.md` with `tasks.md`: a checked task is complete; for an unchecked in-progress task, preserve valid partial work and continue at the first unmet criterion; with no in-progress task, start the first unchecked task. Never discard existing changes as part of handoff. Read only design sections and files needed for that task; avoid repeating the broad playback audit. If blocked, record the exact blocker and continue only independent tasks whose dependencies permit it.
