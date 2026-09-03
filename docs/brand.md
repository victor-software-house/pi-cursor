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
