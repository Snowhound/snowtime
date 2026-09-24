# Snowtime

Minimal multi-tenant time tracker. Start with `docs/product.md` and
`docs/architecture.md`.

# Getting Started

To run this application:

```bash
bun install
bun run db:migrate
bun run db:seed
bun --bun run dev
```

### Seeded users

`bun run db:seed` fills the local database with demo data (`src/db/seed.ts`). It refuses
any database that is not a local file. Every seeded user signs in with the password
`snowtime-local`; password sign-in is enabled only in local development.

| Email                | Name         | Role                                                   |
| -------------------- | ------------ | ------------------------------------------------------ |
| `owner@example.com`  | Olivia Owner | Owner of Northwind Studio                              |
| `admin@example.com`  | Adam Admin   | Admin of Northwind Studio, owner of Harbor Consulting  |
| `lead@example.com`   | Lena Lead    | Member of Northwind Studio, lead of Design             |
| `member@example.com` | Max Member   | Member in Design, Engineering and Harbor's Delivery; has a running timer |
| `theo@example.com`   | Theo Lead    | Member of Northwind Studio, lead of Engineering        |
| `mia@example.com`    | Mia Engineer | Member in Engineering, lead of Delivery in Harbor Consulting |
| `noah@example.com`   | Noah Solo    | Member of Northwind Studio, in no team                 |

To start over: `rm local.db && bun run db:migrate && bun run db:seed`.

## Database and data model

- **Schema changes** are hand-written SQL migrations: `bun run db:generate <name>`, write
  the SQL, `bun run db:migrate`, then update `src/db/schema.ts` to match and check with
  `bun run db:drift`. Full workflow and rules: [`docs/migrations.md`](docs/migrations.md).
- **Viewing the data model:** `bun run datamodel` starts ChartDB on
  http://localhost:8080; import `datamodel/snowtime.chartdb.json` via
  **Actions > Import > .json** (not the `.dbml`). Details and the edit flow:
  [`datamodel/README.md`](datamodel/README.md).

# Building For Production

To build this application for production:

```bash
bun --bun run build
```

## Styling

This project uses [Tailwind CSS](https://tailwindcss.com/) for styling.

### Removing Tailwind CSS

If you prefer not to use Tailwind CSS:

1. Remove the demo pages in `src/routes/demo/`
2. Replace the Tailwind import in `src/styles.css` with your own styles
3. Remove `tailwindcss()` from the plugins array in `vite.config.ts`
4. Remove `@tailwindcss/vite` and `tailwindcss` from `package.json`


## Deploy to Vercel

1. Push this repo to GitHub, GitLab, or Bitbucket
2. In Vercel, choose **Add New > Project** and import the repo
3. Keep the detected TanStack Start framework settings
4. Add production values from `.env.example` under **Settings > Environment Variables**
5. Deploy

Vercel runs the build script and deploys Nitro's output as Vercel Functions and
static assets. The included `vercel.json` makes framework detection explicit.

Variables prefixed with `VITE_` are included in the browser bundle. Keep secrets
unprefixed so they remain server-only.


## Setting up Better Auth

1. Generate and set the `BETTER_AUTH_SECRET` environment variable in your `.env.local`:

   ```bash
   bunx --bun @better-auth/cli secret
   ```

2. Visit the [Better Auth documentation](https://www.better-auth.com) to unlock the full potential of authentication in your app.

### Adding a Database (Optional)

Better Auth can work in stateless mode, but to persist user data, add a database:

```typescript
// src/lib/auth.ts
import { betterAuth } from "better-auth";
import { Pool } from "pg";

export const auth = betterAuth({
  database: new Pool({
    connectionString: process.env.DATABASE_URL,
  }),
  // ... rest of config
});
```

Then run migrations:

```bash
bunx --bun @better-auth/cli migrate
```


## Solid-UI

This installation of Solid-UI follows the manual instructions but was modified to work with Tailwind V4.

To install the components, run the following command (this install button):

```bash
bunx --bun solidui-cli@latest add button
```


## T3Env

- You can use T3Env to add type safety to your environment variables.
- Add Environment variables to the `src/env.mjs` file.
- Use the environment variables in your code.

### Usage

```ts
import { env } from "@/env";

console.log(env.VITE_APP_TITLE);
```






## Routing

This project uses [TanStack Router](https://tanstack.com/router) with file-based routing. Routes are managed as files in `src/routes`.

### Adding A Route

To add a new route to your application just add a new file in the `./src/routes` directory.

TanStack will automatically generate the content of the route file for you.

Now that you have two routes you can use a `Link` component to navigate between them.

### Adding Links

To use SPA (Single Page Application) navigation you will need to import the `Link` component from `@tanstack/solid-router`.

```tsx
import { Link } from "@tanstack/solid-router";
```

Then anywhere in your JSX you can use it like so:

```tsx
<Link to="/about">About</Link>
```

This will create a link that will navigate to the `/about` route.

More information on the `Link` component can be found in the [Link documentation](https://tanstack.com/router/v1/docs/framework/solid/api/router/linkComponent).

### Using A Layout

In the File Based Routing setup the layout is located in `src/routes/__root.tsx`. Anything you add to the root route will appear in all the routes.

More information on layouts can be found in the [Layouts documentation](https://tanstack.com/router/latest/docs/framework/solid/guide/routing-concepts#layouts).

## Server Functions

TanStack Start provides server functions that allow you to write server-side code that seamlessly integrates with your client components.

```tsx
import { createServerFn } from '@tanstack/solid-start'

const getServerTime = createServerFn({
  method: 'GET',
}).handler(async () => {
  return new Date().toISOString()
})
```

## Data Fetching

There are multiple ways to fetch data in your application. You can use TanStack Query to fetch data from a server. But you can also use the `loader` functionality built into TanStack Router to load the data for a route before it's rendered.

For example:

```tsx
import { createFileRoute } from '@tanstack/solid-router'

export const Route = createFileRoute('/people')({
  loader: async () => {
    const response = await fetch('https://swapi.dev/api/people')
    return response.json()
  },
  component: PeopleComponent,
})

function PeopleComponent() {
  const data = Route.useLoaderData()
  return (
    <ul>
      <For each={data().results}>
        {(person) => <li>{person.name}</li>}
      </For>
    </ul>
  )
}
```

Loaders simplify your data fetching logic dramatically. Check out more information in the [Loader documentation](https://tanstack.com/router/latest/docs/framework/solid/guide/data-loading#loader-parameters).





# Learn More

You can learn more about all of the offerings from TanStack in the [TanStack documentation](https://tanstack.com).

For TanStack Start specific documentation, visit [TanStack Start](https://tanstack.com/start).
