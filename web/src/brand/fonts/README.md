<!-- Packaged guide: commands run from psychosigh-design/. See root README.md for package scope. -->

# PsychoSigh typography assets

The PsychoSigh logo is outlined from **Geist** (weight 620) by `tools/build-logos.py`; it does not need any font at runtime. The owner-supplied [**ASIX Founder Regular**](ASIX-FOUNDER.otf) (the original Allium logo face) is kept unchanged with its provenance note but is no longer used by the PsychoSigh identity. Ordinary text uses **Geist Sans**, technical alignment uses **Geist Mono**, and large expressive lettering on black uses **Geist Pixel Square**. This is the typography baseline of the owner-designated brand-kit reference. Use the adjacent agent design system for interface roles and sizing.

## Geist

Source: [official Vercel Geist repository](https://github.com/vercel/geist-font) and [typeface overview](https://vercel.com/font).

Pinned source revision: `b5d164a0c066c2c9bfcd5ab65dd8244551f0ac06`.

- [Geist Sans variable](Geist-Variable.woff2): `packages/next/dist/fonts/geist-sans/Geist-Variable.woff2`
- [Geist Mono variable](GeistMono-Variable.woff2): `packages/next/dist/fonts/geist-mono/GeistMono-Variable.woff2`
- [Geist Pixel Square](GeistPixel-Square.woff2): `fonts/GeistPixel/webfonts/GeistPixel-Square.woff2`
- `OFL.txt`: original repository license, included unchanged.

Vercel identifies the font family as SIL Open Font License 1.1. Keep the included license with redistributed fonts. The preview serves these files locally; it does not call a font CDN or install system fonts.

## ASIX Founder

`ASIX-FOUNDER.otf` is copied unchanged from the user's `HVNTER.NET FREE STUFF DOWNLOADS` folder. It is included as the user's original design input; the exact logo uses outlines and does not need the font at runtime. The selected style is **Regular**, not Italic.

The provided file contains no license text in the inspected name metadata. A first-party license for this specific file was not established during this work. Keep that source distinction with the kit; outlining the letters does not establish broader permission. This note does not block local brand exploration.

## Practical use

Use the SVG wordmark for the PsychoSigh name. Use the fonts for supporting typography; avoid recreating the logo with live text. `../tokens.css` defines the local font faces and their role variables.
