# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root, or **`CONTEXT-MAP.md`** if the repo later gains multiple contexts: read the context relevant to the topic.
- **`docs/adr/`**: read decisions relevant to the area you're about to change. In a multi-context repo, also check context-scoped ADRs.

If a relevant file does not exist, proceed silently. The `/domain-modeling` skill creates glossary entries when terms are resolved and ADRs when a real decision warrants one.

## File structure

Sadhana currently uses a single context:

```text
/
|-- CONTEXT.md
|-- docs/adr/
|   `-- 0001-decision.md
`-- apps/web/src/
```

If the repo later grows into multiple distinct domain contexts, add a root `CONTEXT-MAP.md` pointing to their `CONTEXT.md` files and keep system-wide decisions in `docs/adr/`. Put context-specific ADRs beside the corresponding context.

## Use the glossary's vocabulary

When an issue, spec, test, code change, or report names a domain concept, use the term defined in `CONTEXT.md`. Do not drift to a synonym listed under `_Avoid_`.

If a needed concept is missing, reconsider whether it is a term the product actually uses. If it is, or a proposed meaning conflicts with the glossary, resolve the terminology against the product behavior and code, then update the glossary through `/domain-modeling`.

## Keep the glossary focused

`CONTEXT.md` is a domain glossary, not a spec or an implementation guide.

- Keep each definition to one or two sentences describing what the concept is.
- Keep canonical terms, stable domain relationships, and `_Avoid_` synonyms.
- Put UI flows, API mechanics, date calculations, and other implementation rules in specs and tests.
- Record an ADR only for a hard-to-reverse decision that would be surprising without context and came from a real trade-off.

## Flag ADR conflicts

If a proposed change contradicts an existing ADR, surface the conflict explicitly before changing the decision.
