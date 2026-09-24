import { Show } from 'solid-js'
import { authClient } from '~/lib/auth-client'

export default function BetterAuthHeader() {
  const session = authClient.useSession()

  return (
    <Show
      when={!session().isPending}
      fallback={<div class="h-8 w-8 animate-pulse bg-neutral-100 dark:bg-neutral-800" />}
    >
      <Show when={session().data?.user}>
        {(user) => (
          <div class="flex items-center gap-2">
            <Show
              when={user().image}
              fallback={
                <div class="flex h-8 w-8 items-center justify-center bg-neutral-100 dark:bg-neutral-800">
                  <span class="text-xs font-medium text-neutral-600 dark:text-neutral-400">
                    {user().name?.charAt(0).toUpperCase() || 'U'}
                  </span>
                </div>
              }
            >
              {(image) => <img src={image()} alt="" class="h-8 w-8" />}
            </Show>
            <button
              onClick={() => {
                void authClient.signOut()
              }}
              class="h-9 flex-1 border border-neutral-300 bg-white px-4 text-sm font-medium text-neutral-900 transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:hover:bg-neutral-800"
            >
              Sign out
            </button>
          </div>
        )}
      </Show>
    </Show>
  )
}
