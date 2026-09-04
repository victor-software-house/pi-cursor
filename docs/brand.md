# Mark

Four congruent slabs pinwheeled around the centre of the square: the four legs of one turn. Pi
assembles the context, Pi sends the request, **Cursor streams the routed inference**, Pi commits the
transcript. Three legs are ink, one is magenta, and the magenta leg is 25% of the figure by area, so
the ownership ratio is drawn rather than implied. The four gaps are the handoffs. The cross-shaped
void in the middle is the turn's own state, which never leaves Pi.

This is an unofficial provider. The mark borrows nothing from Cursor's own logo, letterforms, or
isometric geometry, and it must stay that way.

| File | Use |
|:--|:--|
| [`mark.svg`](mark.svg) | Square mark, paper field. Avatar, favicon, docs. |
| [`mark-dark.svg`](mark-dark.svg) | Same geometry, graphite field. |
| [`banner.svg`](banner.svg) | README header, 1200×240. |
| [`banner-dark.svg`](banner-dark.svg) | Same, graphite field. |
| `gallery.svg` | pi.dev package card, 3840×2160 on a 1200×675 design grid. Repository-only: it is **not** in the package `files` whitelist, so do not link to it from a packaged file — see [Gallery](#gallery). |
| [`gallery.png`](gallery.png) | The shipped card image, rendered 1:1 from `gallery.svg`. |
| `social-preview.svg` | GitHub repository social preview, 3840×1920 on a 1280×640 design grid. Repository-only: it is not in the package `files` whitelist. |
| `social-preview.png` | The uploaded 2:1 image, rendered from `social-preview.svg`. Repository-only. |

Pair the two fields with `<picture>` and `prefers-color-scheme`. **Never recolour a single file at
the call site**, and never scale the mark to supply padding — see [Construction](#construction).

## Palette

| | Hex | Role |
|:--|:--|:--|
| Paper | `#ecedef` | Field, or figure on graphite |
| Graphite | `#101317` | Figure, or field |
| Magenta | `#c21e86` | The routed leg, and the same accent on the banner chip. One accent, never two |

Banner-only tints: `#5f6469` (muted on paper), `#8b9299` (muted on graphite), `#d9dbde` / `#23272c`
(hairline). The muted tone carries the tagline and the chip outline; the hairline carries nothing but
the 1.5-unit inset border.

The square mark has exactly one magenta shape. The banner repeats that magenta on the chip glyph so
the header matches the mark. It is the same accent, not a second role.

### Measured contrast

| Pair | On paper | On graphite |
|:--|:--|:--|
| Wordmark | 15.90:1 | 15.90:1 |
| Tagline and chip outline (muted) | 5.10:1 | 5.91:1 |
| Magenta `#c21e86` | 4.69:1 | 3.39:1 |

Text clears 4.5:1 on both fields; the accent clears 3:1 for non-text on both. That is what lets one
magenta value serve light and dark without a second file.

**Before changing the accent hue**, check it against this pair: any replacement must have WCAG
relative luminance in **L ∈ [0.119, 0.249]** to clear 3:1 against both `#ecedef` and `#101317`.
Magenta sits at 0.141. A hue outside that band fails one field. The band is specific to this field
pair and does not transfer if the neutrals change.

## Construction

A 32-unit square, corner radius 6. One slab is defined; the other three are that slab rotated.

Define the top slab as `4.5,4.5 13.5×6.5`. Under **90° rotation about `16,16`** —
`(x,y) → (32−y, x)` — the top slab maps exactly onto the right slab, the right onto the bottom, the
bottom onto the left, and the left back onto the top:

| Slab | Rect | Fill |
|:--|:--|:--|
| Top | `4.5,4.5 13.5×6.5` | Graphite |
| Right | `21,4.5 6.5×13.5` | **Magenta** |
| Bottom | `14,21 13.5×6.5` | Graphite |
| Left | `4.5,14 6.5×13.5` | Graphite |

**That rotation is the construction rule. Verify any edit by rotating one slab onto the next, never
by eye.** The figure spans `4.5–27.5` on both axes, so it is centred on the square and clears the
field by 4.5 units on every side.

Two numbers are load bearing.

**Every gap is 3 units** — one at each corner of the whirl: between the top slab's right end at
`x 18` and the right slab at `x 21`, and its three rotations. That is 1.5px at 16px, which holds.
Closing any gap turns the pinwheel into a closed ring, which is a different and much weaker mark.

**Slab thickness is 6.5 units, not 3.** At 3 units the same four-slab arrangement scatters into
unrelated dashes at 16px and the rotation stops reading. This was measured at 16px, not assumed, and
it is the reason the slabs are slabs.

Pad by moving geometry, never by scaling the figure inside the square: a scale takes the 3-unit gaps
down with it, and the gaps are the first thing to disappear at 16px — which is the size the mark is
checked at.

No two slabs touch. The magenta slab therefore abuts nothing, and no ink-to-accent antialias seam is
possible anywhere in the file. The three graphite slabs are subpaths of **one** `<path>` for the same
reason: as separate `<rect>`s each antialiases against the field, so a shared edge on a fractional
coordinate composites to roughly 75% coverage and shows as a grey hairline through the figure. One
path rasterises in one pass. Anything added to this mark goes in the same path.

## Banner geometry

| Element | Geometry |
|:--|:--|
| Field | `0,0 1200×240`, rx 24 |
| Hairline | inset 0.75, rx 23.25, stroke 1.5 |
| Mark tile | `56,64 112×112`, rx 21, **inverted field** |
| Mark placement | `X = 56 + 3.5u`, `Y = 64 + 3.5u` — the 32-unit mark at 3.5× |
| Wordmark | pen origin `x 210`, baseline 123; ends at 507 |
| Tagline | pen origin `x 210`, baseline 157; ends at 720 |
| Chip | `963,99 181×42`, rx 10, outline 1.5; right edge **1144** |
| Chip glyph | `983,113 4×14`, magenta — one slab of the mark |
| Chip label | pen origin `x 999`, baseline 126; ends at 1123.8, right pad 20.2 |

The tile inverts the field, so the mark inside it is paper-on-graphite in `banner.svg` and
graphite-on-paper in `banner-dark.svg`. The magenta slab is identical in both.

## Banner text

Wordmark `pi-cursor`. Tagline `/cursor in Pi · unofficial routed Cursor inference`. Chip
`/cursor usage`.

The wordmark is **`pi-cursor`, not `pi-cursor-inference`**. The public
`pi-cursor-inference@0.0.0` package is a blank name reservation that does not contain this provider,
so putting the package name on the banner would imply the published artifact is this code.
`pi-cursor` is the repository identity and carries no such claim. For the same reason the chip is the
operator surface and **not** an install command.

Set in [Geist Mono](https://github.com/vercel/geist-font) (OFL) 1.700 and converted to outlines:
wordmark **Black 60px with −3 tracking**, tagline **Medium 17px**, chip **Regular 16px**. Geist Mono
advances 600/1000 units per glyph at every weight and applies no kerning, so a run of `n` characters
at size `s` occupies `n · 0.6s` plus tracking — that is where the pen-end numbers in
[Banner geometry](#banner-geometry) come from.

**The shipped SVGs contain no `<text>`, no `font-family`, no `@font-face`, and no font file.** Do not
add one to change wording; reshape instead.

### Regenerating the outlines

To change any of the three strings, re-shape it with HarfBuzz and re-extract the outlines. Save the
script below, put the Geist Mono OTFs in one directory, and run it with
`uv run outline.py --fonts <dir>`; `uv` resolves the inline dependencies itself.

```python
# /// script
# requires-python = ">=3.11"
# dependencies = ["fonttools>=4.53", "uharfbuzz>=0.39"]
# ///
"""Shape a string with HarfBuzz and emit SVG outline path data for the pi-cursor banner."""
import argparse, pathlib
import uharfbuzz as hb
from fontTools.misc.transform import Transform
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont

def outline(fonts, text, weight, size, x, baseline, tracking=0.0):
    path = pathlib.Path(fonts) / f"GeistMono-{weight}.otf"
    face = hb.Face(hb.Blob.from_file_path(str(path)))
    font = hb.Font(face)
    upem = face.upem
    font.scale = (upem, upem)
    buf = hb.Buffer()
    buf.add_str(text)
    buf.guess_segment_properties()
    hb.shape(font, buf, {"kern": True, "liga": True})
    tt = TTFont(path)
    order, gset = tt.getGlyphOrder(), tt.getGlyphSet()
    s, pen_x, parts = size / upem, x, []
    for info, pos in zip(buf.glyph_infos, buf.glyph_positions):
        pen = SVGPathPen(gset, ntos=lambda v: f"{round(v, 2):g}")
        gx, gy = pen_x + pos.x_offset * s, baseline - pos.y_offset * s
        gset[order[info.codepoint]].draw(TransformPen(pen, Transform(s, 0, 0, -s, gx, gy)))
        if d := pen.getCommands():
            parts.append(d)
        pen_x += pos.x_advance * s + tracking
    return "".join(parts), pen_x

RUNS = [
    ("wordmark", "pi-cursor", "Black", 60, 210, 123, -3),
    ("tagline", "/cursor in Pi · unofficial routed Cursor inference", "Medium", 17, 210, 157, 0),
    ("chip", "/cursor usage", "Regular", 16, 999, 126, 0),
]

ap = argparse.ArgumentParser()
ap.add_argument("--fonts", required=True, help="directory holding the Geist Mono OTFs")
args = ap.parse_args()
for name, text, weight, size, x, baseline, tracking in RUNS:
    d, end = outline(args.fonts, text, weight, size, x, baseline, tracking)
    print(f"{name}: pen {x} -> {end}\n{d}\n")
```

Each run becomes **one** `<path>` in the banner, in the fill its role requires: wordmark and chip
label take the figure colour, the tagline takes the muted tint. Coordinates are rounded to two
decimals. The transform `Transform(s, 0, 0, -s, pen_x, baseline)` is what flips the font's y-up
outlines into SVG's y-down space; the negative `s` is not optional.

Tracking is applied as extra advance **after** each glyph, so the pen origin is the left edge of the
first glyph's advance, not of its ink. The ink starts one left-side-bearing further right, which is
why the wordmark's first path coordinate is not 210.

## Gallery

pi.dev renders package media in a **232×129.625** box with `object-fit: cover`, so the source must be
exactly 16:9 or the card crops it. `gallery.svg` and `gallery.png` are **3840×2160 (4K)**, with the
SVG retaining a `0 0 1200 675` design grid so the construction coordinates below stay readable.
Resolution is not the layout contract: 16:9 is. Never reduce the raster below 4K. The bordered card's
inner image box still trims about **2.26 design-grid units off the top and bottom**, so nothing may
sit at the vertical edges.

The card is **full bleed and opaque**: no outer corner radius, no inset hairline, no transparent
pixel. A radius here doubles against the card's own corners, a hairline loses its horizontal runs to
the trim and reads as a frame missing two sides, and transparent corners composite unpredictably
against a page field we do not control. There is one field only: pi.dev serves a single image URL, so
the gallery has no dark variant to pair.

This is not the banner cropped or rescaled. It is a centred vertical stack — mark tile, wordmark,
tagline, chip — sized for a thumbnail. The wordmark-to-tagline size ratio widens from the banner's
3.53 to **4.33** so the wordmark still reads at 232px wide while the tagline stays one exact line.

### Gallery geometry

| Element | Geometry |
|:--|:--|
| Field | `0,0 1200×675`, no radius, opaque `#ecedef` |
| Stack | centred on `x 600`; top `y 92`, bottom `y 582.24`; margins 92 top, 92.76 bottom |
| Mark tile | `496,92 208×208`, rx 39, **inverted field** |
| Mark placement | `X = 496 + 6.5u`, `Y = 92 + 6.5u` — the 32-unit mark at 6.5× |
| Wordmark | pen origin `x 339.48`, baseline 427.5; ink 343.64–856.36, pen end 854.28 |
| Tagline | pen origin `x 239.48`, baseline 483.1; ink 241.9–958.09, pen end 959.48 |
| Chip | `486.88,529.74 226.25×52.5`, rx 12.5; outline inset 0.94, stroke 1.88; right edge **713.13** |
| Chip glyph | `511.88,547.24 5×17.5`, magenta — one slab of the mark |
| Chip label | pen origin `x 531.88`, baseline 563.49; ends at 687.88, right pad 25.25 |

Three vertical gaps carry the grouping, measured **ink box to ink box**, not baseline to baseline:
tile bottom → wordmark ink top **52**, wordmark ink bottom → tagline ink top **22**, tagline ink
bottom → chip top **44**. Ink heights are 91.1 for the wordmark and 20.64 for the tagline.

**The tagline gap is exactly half the chip gap, and that ratio is load bearing.** At the card's
0.19333× those three gaps become 10.1, 4.3 and 8.5 px. Equalise them and the card shows three
equidistant grey lines instead of a wordmark with its subtitle and a separate chip.

The mark tile is 208, not 200, because `u = 6.5` puts every half-unit coordinate of
[Construction](#construction) on an exact two-decimal value. At `u = 6.25` the slabs land on
`x.xx5` and the rotation check below fails on rounding alone.

The chip is the banner chip scaled by **1.25** (label 16 → 20px): box `181×42 rx 10` →
`226.25×52.5 rx 12.5`, glyph `+20,+14 4×14` → `+25,+17.5 5×17.5`, label pen `+36` → `+45`, label
baseline `+27` → `+33.75`. The 45 / 25.25 padding asymmetry is intentional — the magenta bar occupies
the left — so centre the **box** on `x 600`, never the label inside the box.

### Regenerating the gallery outlines

Run the script in [Regenerating the outlines](#regenerating-the-outlines) with this `RUNS` instead.
Wordmark **Black 104px with −5.2 tracking** (the banner's −0.05 em), tagline **Medium 24px**, chip
label **Regular 20px**; the three strings are the banner's, unchanged.

```python
RUNS = [
    ("wordmark", "pi-cursor", "Black", 104, 339.48, 427.5, -5.2),
    ("tagline", "/cursor in Pi · unofficial routed Cursor inference", "Medium", 24, 239.48, 483.1, 0),
    ("chip", "/cursor usage", "Regular", 20, 531.88, 563.49, 0),
]
```

The mark slabs are baked at `496 + 6.5x, 92 + 6.5y`, exactly as the banner bakes them at 3.5×. The
file carries **no `transform` attribute anywhere**; a `translate … scale` wrapper makes every number
in the table above unverifiable.

### Gallery verification

Anything that regenerates the two gallery files must still pass all of it:

1. `xmllint --noout docs/gallery.svg`, intrinsic `width="3840" height="2160"`, a proportional
   `viewBox="0 0 1200 675"`, and a non-empty `aria-label`.
2. No `<text>`, `font-family`, `@font-face`, `base64`, `<image>`, `<script>`, `<metadata>`, comment,
   editor namespace, or filesystem path. The file is one `<svg>`, four `<rect>` and five `<path>`,
   and its only URL is the SVG namespace. Also no `transform` — that one is **gallery-only**, not an
   omission from the shared list, because [Gallery geometry](#gallery-geometry) is stated in absolute
   coordinates and a wrapper transform would make every number in it unverifiable.
3. `magick identify -format '%w x %h %[opaque]' docs/gallery.png` → `3840 x 2160 True`. The raster
   must remain 16:9 and at least 4K; higher resolutions are allowed. The PNG must equal the SVG
   render: `magick compare -metric AE <render> docs/gallery.png null:` → `0`.
4. Rotate each unit slab by `(x,y) → (32−y, x)` and confirm the set is closed, as in
   [Construction](#construction). Never check the mark by eye.
5. Simulate the card **from the PNG**, never by rendering the SVG small — pi.dev resamples a bitmap,
   and a small SVG render is crisper than anything a visitor sees:
   `magick docs/gallery.png -filter Lanczos -resize 232x131! -gravity center -crop 232x130+0+0 card.png`.
   Look at it, and at 2× (`464x261` cropped to `464x260`). Every 3-unit gap in the mark must still be
   open and the magenta slab must still be visible.
6. Render with `FONTCONFIG_FILE` pointing at a config whose only `<dir>` is empty, and confirm the
   output is pixel-identical to a normal render.

## Social preview

GitHub's social-preview surface is 2:1. None of the existing assets fit it: the banner is 5:1,
the gallery is 16:9, and the marks are square. `social-preview.svg` is therefore a dedicated
composition, not a stretched or cropped asset.

The approved layout keeps the banner's reading order: an inverted mark tile on the left, then the
wordmark, subtitle, and usage chip in one text column. It uses the existing palette, Quarter Turn
geometry, outlined Geist Mono lettering, and exact strings. The field is opaque and full bleed so
hosting platforms can apply their own corner treatment.

The source uses a 1280×640 design grid and renders at 3840×1920. The 2:1 proportion is the layout
contract; the 3× raster avoids using GitHub's 1280×640 recommendation as a resolution ceiling.
GitHub documents no maximum pixel dimensions, only a file-size limit below 1 MB.

### Geometry

| Element | Design-grid geometry |
|:--|:--|
| Field | `0,0 1280×640`, opaque `#ecedef` |
| Mark tile | `80,192 256×256`, radius 48 |
| Mark | Quarter Turn at `u = 8`, offset `80,192` |
| Text origin | `x 420`; 84-unit gap after the tile |
| Wordmark | baseline `273.58`, Black 112px, −5.6 tracking |
| Subtitle | baseline `333.88`, Medium 26px |
| Chip | `420,384.74 271.5×63`, Regular 24px label |
| Margins | 80 left/right; 192 top/bottom |

The tile and text band are both centered on `y 320`. The gaps from wordmark to subtitle and subtitle
to chip are 24 and 48 design units, preserving the gallery's 1:2 relationship.

### Regeneration

Use the outline script in [Regenerating the outlines](#regenerating-the-outlines) with:

```python
RUNS = [
    ("wordmark", "pi-cursor", "Black", 112, 420, 273.58, -5.6),
    ("tagline", "/cursor in Pi · unofficial routed Cursor inference", "Medium", 26, 420, 333.88, 0),
    ("chip", "/cursor usage", "Regular", 24, 474, 425.24, 0),
]
```

Bake the mark at `80 + 8x, 192 + 8y`. Keep coordinates absolute; do not add a wrapper transform.
Render the PNG at 3840×1920.

### Verification

1. Validate the SVG and require intrinsic `3840×1920`, `viewBox="0 0 1280 640"`, and an
   `aria-label`.
2. Reject embedded text, fonts, images, scripts, metadata, transforms, comments, file paths, or
   external URLs. The expected structure is one SVG, four rectangles, and five paths.
3. Require an opaque 3840×1920 PNG below 1 MB and pixel equality with an `rsvg-convert` render.
4. Inspect 1280×640 and smaller 2:1 downscales from the PNG, plus a centered 1.91:1 crop. The mark's
   gaps and magenta slab must remain visible.
5. Confirm an empty-fontconfig render is pixel-identical.

## Verification

Anything that regenerates these files must still pass all of it:

1. `xmllint --noout` on all four files.
2. Both banners exactly `width="1200" height="240"` with a matching `viewBox`, both marks
   `viewBox="0 0 32 32"`, and a non-empty `aria-label` on all four including the dark variants.
3. No `<text>`, `font-family`, `@font-face`, `base64`, `<image>`, `<script>`, `<metadata>`, comment,
   editor namespace, or filesystem path in any of the four files.
4. Render each banner in **both** fields and look at it. Exit 0 is not evidence.
5. Render both marks at **16px** and look at them. Every 3-unit gap must still be open and the
   magenta slab must still be visible. This is the size that decides whether an edit is allowed.
6. Rendering with fontconfig pointed at a directory containing no fonts must be pixel-identical to a
   normal render. That is the proof there is no font dependency left, and it currently holds exactly.
