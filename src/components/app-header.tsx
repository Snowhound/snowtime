// The signed-in header every page shares (prototypes/app-frame.js): the organization
// switcher, the navigation, and the user menu. Below 768 px the navigation moves to a
// second row of equal-width links.
import { useQuery, useQueryClient } from '@tanstack/solid-query'
import { Link, useNavigate, useRouter, useRouterState } from '@tanstack/solid-router'
import BuildingComplexIcon from 'lucide-solid/icons/building-complex'
import ChartColumnIcon from 'lucide-solid/icons/chart-column'
import ChevronsUpDownIcon from 'lucide-solid/icons/chevrons-up-down'
import ClockIcon from 'lucide-solid/icons/clock'
import FolderKanbanIcon from 'lucide-solid/icons/folder-kanban'
import LogOutIcon from 'lucide-solid/icons/log-out'
import MonitorIcon from 'lucide-solid/icons/monitor'
import MoonIcon from 'lucide-solid/icons/moon'
import PlusIcon from 'lucide-solid/icons/plus'
import SettingsIcon from 'lucide-solid/icons/settings'
import SunIcon from 'lucide-solid/icons/sun'
import TimerIcon from 'lucide-solid/icons/timer'
import UserIcon from 'lucide-solid/icons/user'
import type { Component } from 'solid-js'
import { For, Show } from 'solid-js'
import type { AppSession } from '../functions/auth'
import { authClient } from '../lib/auth-client'
import { type ThemeSetting, sessionQuery } from '../lib/session'
import { useUpdateSettings } from '../lib/settings'
import { cn, initials } from '../lib/utils'
import { m } from '../paraglide/messages.js'
import { Avatar, AvatarFallback } from './ui/avatar'
import { Button, buttonVariants } from './ui/button'
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
} from './ui/dropdown-menu'

const NAV = [
  { to: '/timer', label: m.nav_timer, Icon: TimerIcon },
  { to: '/reports', label: m.nav_reports, Icon: ChartColumnIcon },
  { to: '/projects', label: m.nav_projects, Icon: FolderKanbanIcon },
  { to: '/organization', label: m.nav_organization, Icon: BuildingComplexIcon, admin: true },
] as const

const THEMES: { value: ThemeSetting; label: () => string; Icon: Component<{ class?: string }> }[] =
  [
    { value: 'light', label: m.theme_light, Icon: SunIcon },
    { value: 'dark', label: m.theme_dark, Icon: MoonIcon },
    { value: 'system', label: m.theme_system, Icon: MonitorIcon },
  ]

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
        <header class="bg-background border-b">
          <div class="mx-auto flex h-14 max-w-6xl items-center gap-1 px-4 sm:gap-2 sm:px-8">
            <Link
              to="/timer"
              class="focus-visible:ring-ring mr-1 flex shrink-0 items-center gap-2 rounded-md text-sm font-semibold focus-visible:ring-2 focus-visible:outline-none"
              aria-label={m.app_home()}
            >
              <ClockIcon class="size-5" aria-hidden="true" />
              <span class="hidden sm:inline">{m.app_name()}</span>
            </Link>
            <span class="bg-border mx-1 h-5 w-px shrink-0" aria-hidden="true" />
            <OrganizationSwitcher session={data()} />
            <nav class="ml-2 hidden items-center gap-1 md:flex" aria-label={m.nav_main()}>
              <NavLinks role={data().role} />
            </nav>
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

  // Every organization-scoped query belongs to the old organization, so all of them load
  // again, and the routes check the role in the new one.
  async function switchTo(organizationId: string) {
    if (organizationId === props.session.activeOrganizationId) return
    await authClient.organization.setActive({ organizationId })
    await queryClient.invalidateQueries()
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

  // The theme applies at once: the root renders data-theme from the session query.
  const saveSettings = useUpdateSettings()

  async function signOut() {
    await authClient.signOut()
    queryClient.clear()
    await navigate({ to: '/sign-in' })
  }

  return (
    <DropdownMenu placement="bottom-end">
      <DropdownMenuTrigger
        class="focus-visible:ring-ring focus-visible:ring-offset-background ml-auto shrink-0 rounded-full focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
        aria-label={m.user_menu_label({ name: props.session.user.name })}
      >
        <Avatar class="size-8">
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
        <DropdownMenuRadioGroup
          value={props.session.settings?.theme ?? 'system'}
          onChange={(theme) => saveSettings.mutate({ theme })}
        >
          <DropdownMenuGroupLabel class="text-muted-foreground text-xs font-medium">
            {m.user_menu_theme()}
          </DropdownMenuGroupLabel>
          <For each={THEMES}>
            {(theme) => (
              <DropdownMenuRadioItem value={theme.value} class="gap-2" closeOnSelect={false}>
                <theme.Icon class="size-4" aria-hidden="true" />
                {theme.label()}
              </DropdownMenuRadioItem>
            )}
          </For>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={signOut}>
          <LogOutIcon class="size-4" aria-hidden="true" />
          {m.auth_sign_out()}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
