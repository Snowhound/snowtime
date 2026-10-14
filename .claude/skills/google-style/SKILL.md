---
name: google-style
description: Draft substantial repository documentation or review prose for clarity. Use for new or substantially rewritten README or docs sections and explicit prose reviews. Routine factual corrections, task-status updates, and code edits use AGENTS.md without this skill.
---

# Writing review

Apply the writing rules in `AGENTS.md`. This skill adds a focused editing pass for
developers who need to understand a decision and act on it. It adapts the
[Google developer documentation style guide](https://developers.google.com/style).

## Draft and edit

- Identify what the reader needs to learn or do. Put that point first; include the
  evidence, constraints, and trade-offs needed to assess it.
- Where the reader expects a recommendation, give one and the condition that would
  change it. State an unknown as unknown, with what would settle it, instead of hedging.
- Edit structure before sentences. Remove duplicated facts and sections that don't
  help the reader. Stay within the requested scope.
- Address the reader in instructions; describe the responsible component in design
  text. Use present tense for defined behavior and label planned behavior explicitly.
- Prefer specific verbs and facts over vague adjectives. Cut filler, marketing
  language, rhetorical pivots, and contrast framing when they add no meaning. Don't
  replace them with stronger claims or treat words as banned strings.
- Split sentences when independent ideas obscure the point. Explain unfamiliar terms
  on first use. Keep enough context for a reader who hasn't seen the conversation.

## Check the result

Reread once for clarity and meaning: can the reader find the action or decision, its
reason, and its limits? Remove repetition without losing qualifications. When revising,
compare with the source for changed facts, conditions, obligations, or decision status.
Check changed links and Markdown structure. Flag unresolved contradictions.
