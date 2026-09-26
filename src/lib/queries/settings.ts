import { useMutation, useQueryClient } from '@tanstack/solid-query'
import type { AppSession } from '~/server/auth/auth.functions'
import { updateSettings } from '~/server/settings/settings.functions'
import type { UpdateSettingsInput } from '~/server/settings/settings.schemas'
import { optimistic } from './query'
import { sessionQuery } from './session'

// The signed-in user's settings, as the session query carries them.
export type Settings = NonNullable<AppSession['settings']>

// Saves a partial settings patch. The session query carries the settings, so the change
// shows at once everywhere that reads them: the theme on <html>, the language, the timer
// layout. The settings page, the timer's View popover, and the user menu all save here.
export function useUpdateSettings() {
  const queryClient = useQueryClient()
  return useMutation(() => ({
    mutationFn: (patch: UpdateSettingsInput) => updateSettings({ data: patch }),
    ...optimistic<AppSession | null, UpdateSettingsInput>(queryClient, {
      queryKey: sessionQuery.queryKey,
      update: (session, patch) =>
        session?.settings ? { ...session, settings: { ...session.settings, ...patch } } : session,
    }),
  }))
}
