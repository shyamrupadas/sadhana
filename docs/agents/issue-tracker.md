# Issue tracker: Local Markdown

Specs and tickets live as Markdown files in `.scratch/`. Use `to-spec` to create or refine a spec, then `to-tickets` to publish implementation tickets from it.

## Files and metadata

- One feature per directory: `.scratch/<feature-slug>/`.
- The spec is `.scratch/<feature-slug>/spec.md`.
- Implementation tickets are separate files at `.scratch/<feature-slug>/issues/<NN>-<slug>.md`, numbered from `01` in dependency order.
- Specs use a plain top-level `Status:` line. Implementation tickets use `**Blocked by:**` and `**Status:**` lines as emitted by `to-tickets`.
- Append discussion to the relevant file under `## Comments`.
- `Accepted: YYYY-MM-DD` directly after the status line is the completion marker for a spec or implementation ticket. Do not replace the status with `done` or remove blocking edges.

## Implementation ticket format

Use the local `to-tickets` template, one ticket per file:

```markdown
# <NN>: <Ticket title>

**What to build:** <end-to-end behaviour visible to the user>

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] <Acceptance criterion>
```

For a blocked ticket, replace `None (can start immediately)` with `NN — Ticket title; NN — Ticket title`. Keep `**Blocked by:**` and `**Status:**` as top-level metadata, not section headings or plain `Status:` lines. Put supporting sections after the acceptance criteria.

## Dependencies and frontier

- The two-digit number identifies a ticket within its feature's `issues/` directory. Resolve a blocking reference by number; report a title mismatch.
- Before publishing tickets or changing an edge, check that every blocker exists, has a lower number, and is referenced only once. Reject missing, ambiguous, self-referential, malformed, and cyclic edges.
- A blocker is complete only when its file has `**Status:** awaiting-human-review` followed immediately by a top-level `Accepted: YYYY-MM-DD` line. A mention in the body or comments does not count.
- The implementation frontier consists of tickets with `**Status:** ready-for-agent`, no `Accepted:` marker, and only accepted blockers. Validate the graph before starting a ticket; report invalid references or open blockers and work only on the frontier.
- Keep dependency references after acceptance. Change them only to correct a planning error, then validate the graph again.

## Status and acceptance

- Incoming request triage uses the roles in `triage-labels.md`: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, and `wontfix`. Tickets produced by `to-tickets` are already agent-ready and do not need triage.
- Implementation moves from `ready-for-agent` to `awaiting-human-review` after the work and required checks are complete. Update `**Status:**` and report the ticket for review. Completing implementation alone does not add `Accepted:`.
- `ready-for-human` means human implementation is needed. After that implementation, set `awaiting-human-review` before acceptance.
- When the human accepts an `awaiting-human-review` ticket, keep its status and add `Accepted: YYYY-MM-DD` directly after `**Status:**`. Then re-evaluate the frontier and report the lowest-numbered available ticket.
- When every implementation ticket for a spec is accepted, set the spec's plain `Status:` to `awaiting-human-review`. When the human accepts the spec, keep its status and add `Accepted: YYYY-MM-DD` directly after it.

## Skill operations

- "Publish to the issue tracker": create or update the spec or one numbered ticket file under `.scratch/<feature-slug>/`. Validate the complete dependency graph before publishing tickets.
- "Fetch the relevant ticket": read the given path, or resolve its number within the named feature's `issues/` directory.

## Wayfinding decisions

Wayfinding uses `.scratch/<effort-slug>/map.md` and numbered decision tickets in `.scratch/<effort-slug>/decisions/`; keep them separate from implementation tickets in `issues/`.

- The map contains `Destination`, `Notes`, `Decisions so far`, `Not yet specified`, and `Out of scope`.
- A decision ticket uses `Type: research | prototype | grilling | task`, `Status: open | claimed | resolved`, and `Blocked by:` metadata. Its frontier is the lowest-numbered open, unclaimed decision whose blockers are all resolved.
- Claim a frontier decision by setting `Status: claimed` before working. Resolve it by writing `## Answer`, setting `Status: resolved`, and adding a one-line link to the map's `Decisions so far`.
- Decision tickets do not use implementation triage statuses or `Accepted:`. Once the route is clear, use the resolved decisions as sources for `to-spec` and `to-tickets`.
