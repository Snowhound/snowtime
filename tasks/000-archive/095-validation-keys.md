# 095: Validation failures answer a key

Status: in-progress

Input that fails its schema answers 400 with `{ error: { message } }`, where `message` is
the first issue's text. The schemas' custom messages are Paraglide calls, which run in the
request's locale, so a browser session in Estonian gets Estonian text. That breaks the
API's own contract (`docs/api.md`, "Errors": messages are always in English), makes the
answer depend on the locale, and leaves clients nothing stable to branch on. The native
backend answers English, as the contract says, so the two backends differ outside English.

Answer a validation failure as the app's rules already answer a refusal: with a `key` the
client translates, its `params`, and the English `message` the contract promises:

```json
{
  "error": {
    "key": "validation_too_long",
    "params": { "max": 500 },
    "message": "Use at most 500 characters."
  }
}
```

The schemas keep their Paraglide messages: the browser's forms validate with the same
schemas and show the user's language. Only the server's answer changes. A schema check
without a key of its own, such as valibot's type checks, answers `validation_invalid` with
valibot's English message.

## Acceptance criteria

- [x] Every custom schema message names its key and parameters; the server answers them
      with the message in English, whatever the request's locale.
- [x] Valibot's own checks answer `validation_invalid` with their English message.
- [x] The client shows a validation key's text in the user's language, with its parameters,
      and falls back to `message` for a key it doesn't know.
- [x] `docs/api.md` documents the new body; conformance tests cover an Estonian session.
- [x] Format, lint, types, unit tests, and the conformance suite pass.
- [ ] snowtime-native follows (its task records the change), and the byte comparison passes.
