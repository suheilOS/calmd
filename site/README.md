# Calmd landing page

A dependency-light Astro site for the Calmd product story. It uses native HTML controls and global CSS without React, Base UI, or Tailwind.

## Development

Run commands from the `site/` directory:

```sh
bun install
bun run dev
```

The development server is available at `http://localhost:4321` by default.

## Checks

```sh
bun run check
bun run build
```

`check` validates Astro and TypeScript source. `build` generates the static site in `site/dist/`.

## Cloudflare Pages

The site is configured for a direct-upload Cloudflare Pages deployment. The Pages
project name is `calmd`; change `name` in `wrangler.jsonc` before the first
deployment if your desired `*.pages.dev` address differs.

Authenticate once, then deploy from `site/`:

```sh
bunx wrangler login
bun run deploy:pages
```

Create the Pages project once before the first deployment:

```sh
bun run pages:create
```

Use a preview deployment while reviewing changes:

```sh
bun run deploy:preview
```

To serve the production build in the local Cloudflare Pages runtime:

```sh
bun run pages:dev
```
