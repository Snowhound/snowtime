# 038: Cookie consent

Status: done

The ePrivacy Directive (in Estonia, the Electronic Communications Act § 1021) requires
consent before storing anything on a device, unless it is strictly necessary for a service
the user asked for. The privacy policy (`/privacy`) claims Snowtime needs no consent
banner, since it stores only:

- Better Auth's sign-in cookies
- Paraglide's language cookie, which lasts about 400 days
- localStorage for the device's appearance settings, whether the intro was seen, and
  whether the prompt to add a passkey was dismissed (`src/lib/device-settings.ts`,
  `src/lib/intro.ts`, `src/components/app-frame/passkey-prompt.tsx`)

The EU data protection authorities' guidance (Article 29 Working Party, Opinion 04/2012)
exempts authentication cookies and user-interface customization, such as a chosen
language, which covers all three. MinuPatsient
(<https://www.minupatsient.ee/terms/data>) instead treats its preference cookies as
consent-based (GDPR Article 6(1)(a)). Confirm the exemption holds, or add consent.

The exemption holds; `docs/architecture.md`, "Cookies and consent", records the check.
The language cookie is now written only for an account language that differs from the
browser's, and lasts 30 days.

## Acceptance criteria

- [x] Each cookie and storage key is listed with its purpose and lifetime, and checked
      against the exemption, including whether the appearance settings count as
      customization the user asked for
- [x] Either the privacy policy's cookie section states the exemption and lists the
      items, or a consent prompt gates what isn't exempt, and the app works when it is
      declined
- [x] The language cookie's lifetime is set deliberately rather than left at Paraglide's
      default, if the check calls for it
- [x] Adding analytics or any third-party script later requires revisiting this task;
      `docs/architecture.md` records that
