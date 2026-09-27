# 06: Review of the Estonian lines

Status: todo

The Estonian taglines were written for Estonian rather than translated, but by a model that
is weaker in Estonian than in English, and some read stiffly. For example, "Pane see raami"
became "Raami see ära". Once subtask 05 has added its sets, have Gemini 3.8, which is better
at Estonian, review every Estonian line: the catalogue's sets (`src/lib/taglines/catalogue.ts`)
and the season's sets (`season_*` in `messages/et.json`).

The review checks that each line sounds natural and colloquial, keeps the tone of the
existing sets (never satisfied: praise ends in a demand), and reads well with its
placeholders filled: `{hours}` from 8 up, and `{days}` from 1 up.

## Acceptance criteria

- [ ] Gemini 3.8 has reviewed every Estonian tagline, and its suggestions are applied or
      declined with a reason
- [ ] The Estonian lines still have the same placeholders as the English ones (the catalogue
      test)
