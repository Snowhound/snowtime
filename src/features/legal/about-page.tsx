import { Link } from '@tanstack/solid-router'
import { Show } from 'solid-js'
import { buttonVariants } from '~/components/ui/button'
import { sessionQuery } from '~/lib/queries/session'
import { useQuery } from '~/lib/queries/use-query'
import { m } from '~/paraglide/messages.js'
import { getLocale } from '~/paraglide/runtime.js'
import { COMPANY, ContactEmail, LegalLayout } from './legal-layout'

// The public home page: what Snowtime does, for people who haven't signed in and for Google's
// review of the calendar scopes, which needs a page that describes the app and links to the
// privacy policy (docs/deployment/README.md, "Get the app verified").
export function AboutPage() {
  const session = useQuery(() => sessionQuery)
  return (
    <LegalLayout title={m.about_title()}>
      {getLocale() === 'et' ? <AboutEt /> : <AboutEn />}
      <p class="mt-8!">
        <Show
          when={session.data}
          fallback={
            <Link to="/sign-in" class={`${buttonVariants()} no-underline!`}>
              {m.sign_in_title()}
            </Link>
          }
        >
          <Link to="/" class={`${buttonVariants()} no-underline!`}>
            {m.about_open()}
          </Link>
        </Show>
      </p>
    </LegalLayout>
  )
}

function AboutEn() {
  return (
    <>
      <p>
        Snowtime is a time tracker for teams, run by {COMPANY.name}. You start a timer when you
        begin a task, or add the time afterwards, and your organization sees where its time goes.
      </p>

      <h2>What it does</h2>
      <ul>
        <li>A one-click timer, and entries you add or edit in a list by day or a week calendar.</li>
        <li>
          Organizations with teams, projects, and roles: members see their own time, team leads
          their teams', and admins the whole organization.
        </li>
        <li>Reports per day, week, project, team, or member, exported as CSV or XLSX.</li>
        <li>An API with personal keys, for scripts and a Raycast extension.</li>
      </ul>

      <h2>Google Calendar</h2>
      <p>
        You can connect a Google Calendar in Settings. Snowtime then shows your meetings beside your
        time on the Timer page, and logs a meeting as a time entry when you ask, with its title and
        times. Snowtime only reads your calendars and events: it never changes them, and it doesn't
        store your events. The <Link to="/privacy">privacy policy</Link> says exactly what it reads
        and keeps, and how to disconnect.
      </p>

      <h2>Contact</h2>
      <p>
        Questions or support: <ContactEmail />. Using Snowtime means agreeing to the{' '}
        <Link to="/terms">terms of service</Link>.
      </p>
    </>
  )
}

function AboutEt() {
  return (
    <>
      <p>
        Snowtime on meeskondade ajaarvestuse rakendus, mida pakub {COMPANY.name}. Käivitad taimeri,
        kui tööga alustad, või lisad aja hiljem, ja sinu organisatsioon näeb, kuhu tema aeg kulub.
      </p>

      <h2>Mida see teeb</h2>
      <ul>
        <li>
          Ühe klõpsuga taimer ning kanded, mida lisad või muudad päevade kaupa loendis või nädala
          kalendris.
        </li>
        <li>
          Organisatsioonid tiimide, projektide ja rollidega: liikmed näevad oma aega, tiimijuhid oma
          tiimide oma ja administraatorid kogu organisatsiooni oma.
        </li>
        <li>
          Aruanded päeva, nädala, projekti, tiimi või liikme kaupa, alla laaditavad CSV- või
          XLSX-failina.
        </li>
        <li>Isiklike võtmetega API skriptide ja Raycasti laienduse jaoks.</li>
      </ul>

      <h2>Google'i kalender</h2>
      <p>
        Seadetes saad ühendada Google'i kalendri. Siis näitab Snowtime sinu koosolekuid Taimeri
        lehel sinu aja kõrval ja salvestab koosoleku sinu soovil ajakandena koos selle pealkirja ja
        aegadega. Snowtime ainult loeb sinu kalendreid ja sündmusi: ta ei muuda neid kunagi ega
        säilita sinu sündmusi. <Link to="/privacy">Privaatsuspoliitika</Link> ütleb täpselt, mida ta
        loeb ja säilitab ning kuidas ühendus katkestada.
      </p>

      <h2>Kontakt</h2>
      <p>
        Küsimused ja kasutajatugi: <ContactEmail />. Snowtime'i kasutades nõustud{' '}
        <Link to="/terms">kasutustingimustega</Link>.
      </p>
    </>
  )
}
