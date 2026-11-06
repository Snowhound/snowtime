# 097.05: Google verification

Status: in-progress

Get the Google OAuth client verified for the calendar scopes, so users outside its test
list can connect a calendar without the "unverified app" warning. Until then the client
stays in testing mode with up to 100 test users, which is enough to try the integration
at Snowhound.

The event scope, `calendar.events.readonly`, is sensitive: Google reviews the app before
other users can grant it, and its page says the review takes up to 10 days
([Sensitive scope verification][verify]). Sign-in's scopes are not affected, since the
calendar connection asks for its scopes separately (task 097, "Tokens").

## Acceptance criteria

- [ ] The OAuth consent screen lists the calendar scopes, the privacy policy, and the
      verified home page domain
- [ ] A demo video shows a user connecting a calendar and Snowtime using the events, as
      Google asks
- [ ] Google has approved the client, and a user outside the test list connects without
      the warning
- [x] `docs/deployment/README.md` says how a self-hosted deployment sets up its own
      client for calendars, including verification or testing mode

[verify]: https://developer.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification
