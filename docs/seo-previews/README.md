# SEO Preview Gallery

A design QA page showing pixel-accurate mockups of how the Voxel Warlock Brawl Arena share link renders across major platforms.

## What it is

`index.html` renders faithful card mockups for:

| Platform | Card type |
|---|---|
| Facebook | Feed link card (image top, white, domain in caps) |
| X / Twitter | `summary_large_image` card (dark, rounded 16 px) |
| Discord | Embed with ember left accent bar, blurple title link |
| Slack | Unfurl with grey left bar, favicon, thumbnail |
| iMessage | Rounded rich link bubble with footer |
| LinkedIn | Feed card (image top, light footer) |
| WhatsApp | Dark green chat bubble with thumbnail preview |
| Google | SERP snippet (blue title, grey URL breadcrumb, description) |
| Browser | Tab chrome with favicon + address bar |

All copy (title, description, URL) is taken verbatim from the canonical shared-copy spec. The OG image is embedded with a relative `src` pointing to `../../assets/social/og-image.png` — it appears once that file is rasterized by the build step.

## How to open

```bash
open docs/seo-previews/index.html
# or
xdg-open docs/seo-previews/index.html
```

No build step required. It is a fully self-contained static HTML file.

## OG image source

The 1200×630 OG image is generated from:

```
assets/social/og-card.html   ← HTML/CSS source, edit this
assets/social/og-image.png   ← rasterized output (1200×630)
assets/social/og-image-square.png  ← rasterized square crop (630×630)
```

Rasterization is done by the orchestrator (e.g. Puppeteer or a headless-Chrome step) after changes to `og-card.html`.

## Which meta tags drive which platform

| Platform | Primary tags |
|---|---|
| Facebook | `og:image`, `og:title`, `og:description`, `og:url`, `og:site_name` |
| Discord | `og:image`, `og:title`, `og:description`, `og:site_name`, `theme-color` |
| Slack | `og:image`, `og:title`, `og:description`, `og:site_name` |
| LinkedIn | `og:image`, `og:title`, `og:url` |
| WhatsApp | `og:image`, `og:title`, `og:description`, `og:url` |
| iMessage | `og:image`, `og:title`, `og:url` |
| X / Twitter | `twitter:card=summary_large_image`, `twitter:title`, `twitter:description`, `twitter:image` |
| Google SERP | `<title>`, `meta name="description"`, `link rel="canonical"` |
| Browser tab | `<title>`, `link rel="icon"`, `meta name="theme-color"` |

## Canonical copy

| Field | Value |
|---|---|
| Site URL | `https://voxel-warlock-brawl-arena.vercel.app` |
| `<title>` | `Voxel Warlock Brawl — Low-Poly Spell-Slinging Arena Brawler` |
| `og:title` / `twitter:title` | `Voxel Warlock Brawl Arena` |
| Description | `Spell-sling in a low-poly voxel arena. Knock rivals into the lava, outlast the shrinking platform, and be the last warlock standing. Free browser P2P multiplayer — no download.` |
| `og:site_name` | `Voxel Warlock Brawl Arena` |
| `theme-color` | `#0a0814` |
