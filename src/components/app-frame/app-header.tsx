// The signed-in header every page shares (prototypes/app-frame.js): the app icon, the
// organization switcher, the navigation, the Appearance popover, and the user menu. Below 768 px the navigation moves to a
// second row of equal-width links. It sticks to the top, above the cards and below popovers (z-50).
import { useQuery, useQueryClient } from '@tanstack/solid-query'
import { Link, useNavigate, useRouter, useRouterState } from '@tanstack/solid-router'
import BuildingComplexIcon from 'lucide-solid/icons/building-complex'
import ChartColumnIcon from 'lucide-solid/icons/chart-column'
import ChevronsUpDownIcon from 'lucide-solid/icons/chevrons-up-down'
import FileTextIcon from 'lucide-solid/icons/file-text'
import FolderKanbanIcon from 'lucide-solid/icons/folder-kanban'
import LogOutIcon from 'lucide-solid/icons/log-out'
import PlusIcon from 'lucide-solid/icons/plus'
import SettingsIcon from 'lucide-solid/icons/settings'
import ShieldIcon from 'lucide-solid/icons/shield'
import TimerIcon from 'lucide-solid/icons/timer'
import UserIcon from 'lucide-solid/icons/user'
import { For, Show } from 'solid-js'
import { AppMark } from '~/components/app-mark'
import { Avatar, AvatarFallback, AvatarImage } from '~/components/ui/avatar'
import { Button, buttonVariants } from '~/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroupLabel,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu'
import { appIcon } from '~/lib/app-icon'
import { authClient } from '~/lib/auth-client'
import { forgetOrganization, forgetSignedInUser, sessionQuery } from '~/lib/session'
import { cn, initials } from '~/lib/utils'
import { m } from '~/paraglide/messages.js'
import type { AppSession } from '~/server/auth/auth.functions'
import { AppearancePopover } from './appearance-popover'

const NAV = [
  { to: '/timer', label: m.nav_timer, Icon: TimerIcon },
  { to: '/reports', label: m.nav_reports, Icon: ChartColumnIcon },
  { to: '/projects', label: m.nav_projects, Icon: FolderKanbanIcon },
  { to: '/organization', label: m.nav_organization, Icon: BuildingComplexIcon, admin: true },
] as const

function OrgMark(props: { name: string; class?: string }) {
  return (
    <span
      class={cn(
        'flex size-6 shrink-0 items-center justify-center rounded-md bg-primary text-xs font-semibold text-primary-foreground',
        props.class,
      )}
      aria-hidden="true"
    >
      {props.name.charAt(0).toUpperCase()}
    </span>
  )
}

export function AppHeader() {
  const session = useQuery(() => sessionQuery)
  return (
    <Show when={session.data}>
      {(data) => (
        <header class="scene-header bg-background sticky top-0 z-30 border-b">
          <div class="mx-auto flex h-14 max-w-6xl items-center gap-1 px-4 sm:gap-2 sm:px-8">
            <Link
              to="/timer"
              class="focus-visible:ring-ring focus-visible:ring-offset-background mr-1 flex shrink-0 items-center gap-2 rounded-md text-base font-bold tracking-[-0.02em] focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
              aria-label={m.app_home()}
            >
              <AppMark id={appIcon(data().settings?.appIcon).id} small class="size-7" />
              <span class="hidden sm:inline md:hidden lg:inline">{m.app_name()}</span>
            </Link>
            <span class="bg-border mx-1 h-5 w-px shrink-0" aria-hidden="true" />
            <OrganizationSwitcher session={data()} />
            <nav class="ml-2 hidden items-center gap-1 md:flex" aria-label={m.nav_main()}>
              <NavLinks role={data().role} />
            </nav>
            <Show when={data().settings} fallback={<span class="ml-auto" />}>
              {(settings) => <AppearancePopover settings={settings()} />}
            </Show>
            <UserMenu session={data()} />
          </div>
          <nav class="flex gap-1 border-t px-2 py-1.5 md:hidden" aria-label={m.nav_main()}>
            <NavLinks role={data().role} mobile />
          </nav>
        </header>
      )}
    </Show>
  )
}

function NavLinks(props: { role: AppSession['role']; mobile?: boolean }) {
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  function items() {
    return NAV.filter((item) => !('admin' in item) || props.role !== 'member')
  }
  return (
    <For each={items()}>
      {(item) => {
        function current() {
          return pathname() === item.to || pathname().startsWith(`${item.to}/`)
        }
        return (
          <Link
            to={item.to}
            class={cn(
              buttonVariants({ variant: current() ? 'secondary' : 'ghost', size: 'sm' }),
              props.mobile && 'h-9 flex-1 gap-1.5 px-2',
            )}
          >
            <item.Icon aria-hidden="true" />
            {item.label()}
          </Link>
        )
      }}
    </For>
  )
}

function OrganizationSwitcher(props: { session: AppSession }) {
  const queryClient = useQueryClient()
  const router = useRouter()
  const navigate = useNavigate()
  function active() {
    return props.session.organizations.find((o) => o.id === props.session.activeOrganizationId)!
  }

  // The old organization's queries go, the rest load again, and the routes check the role
  // in the new one. A refused switch, such as to an organization the user has just left,
  // stays on this one with the list read again.
  async function switchTo(organizationId: string) {
    const previous = props.session.activeOrganizationId!
    if (organizationId === previous) return
    const { error } = await authClient.organization.setActive({ organizationId })
    if (error) {
      await queryClient.invalidateQueries({ queryKey: sessionQuery.queryKey })
      return
    }
    await forgetOrganization(queryClient, previous)
    await router.invalidate()
  }

  return (
    <DropdownMenu placement="bottom-start">
      <DropdownMenuTrigger
        as={Button<'button'>}
        variant="ghost"
        size="sm"
        class="max-w-[13rem] min-w-0 justify-start gap-2 px-2 lg:max-w-[16rem]"
        aria-label={m.org_switcher_label({ name: active().name })}
      >
        <OrgMark name={active().name} />
        <span class="truncate text-sm">{active().name}</span>
        <ChevronsUpDownIcon class="opacity-50" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent class="w-64">
        <DropdownMenuRadioGroup value={props.session.activeOrganizationId!} onChange={switchTo}>
          <DropdownMenuGroupLabel class="text-muted-foreground text-xs font-medium">
            {m.org_menu_title()}
          </DropdownMenuGroupLabel>
          <For each={props.session.organizations}>
            {(organization) => (
              <DropdownMenuRadioItem value={organization.id} class="gap-2">
                <OrgMark name={organization.name} class="size-5 text-[10px]" />
                <span class="min-w-0 truncate">{organization.name}</span>
              </DropdownMenuRadioItem>
            )}
          </For>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => navigate({ to: '/create-organization' })}>
          <PlusIcon class="size-4" aria-hidden="true" />
          {m.org_menu_create()}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function UserMenu(props: { session: AppSession }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  async function signOut() {
    await authClient.signOut()
    forgetSignedInUser(queryClient)
    await navigate({ to: '/sign-in' })
  }

  return (
    <DropdownMenu placement="bottom-end">
      <DropdownMenuTrigger
        class="focus-visible:ring-ring focus-visible:ring-offset-background shrink-0 rounded-full focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
        aria-label={m.user_menu_label({ name: props.session.user.name })}
      >
        <Avatar class="size-8">
          <Show when={props.session.user.image}>
            {(image) => <AvatarImage src={image()} alt="" />}
          </Show>
          <AvatarFallback class="text-xs font-medium">
            {initials(props.session.user.name)}
          </AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent class="w-60">
        <DropdownMenuLabel class="flex flex-col gap-0.5 font-normal">
          <span class="truncate text-sm font-medium">{props.session.user.name}</span>
          <span class="text-muted-foreground truncate text-xs">{props.session.user.email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => navigate({ to: '/settings', hash: 'profile' })}>
          <UserIcon class="size-4" aria-hidden="true" />
          {m.user_menu_profile()}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => navigate({ to: '/settings' })}>
          <SettingsIcon class="size-4" aria-hidden="true" />
          {m.nav_settings()}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => navigate({ to: '/privacy' })}>
          <ShieldIcon class="size-4" aria-hidden="true" />
          {m.legal_privacy_title()}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => navigate({ to: '/terms' })}>
          <FileTextIcon class="size-4" aria-hidden="true" />
          {m.legal_terms_title()}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={signOut}>
          <LogOutIcon class="size-4" aria-hidden="true" />
          {m.auth_sign_out()}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
