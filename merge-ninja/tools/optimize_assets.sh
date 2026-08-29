#!/usr/bin/env bash
#
# Converts the shipped art in public/assets/ from PNG to WebP.
#
# The art was authored as PNG, which is the wrong container for most of it: the
# arena backdrops are painted illustrations full of smooth gradients, and PNG
# stores those about as badly as a format can. WebP takes the whole folder from
# ~23 MB to ~4 MB, which is the difference between a phone on a slow connection
# reaching the first frame and giving up.
#
# Quality is picked per class, because the classes fail differently:
#
#   lossless  Anything tiled. The floor and tex strips would grow seams at
#             their wrap edges under any lossy pass, and they are small already,
#             so lossless costs nothing worth having.
#
#   near20    The packed atlas. It was lossless on the assumption that it is
#             clean pixel art, where lossy compression bleeds colour across the
#             frame boundaries -- the frames are packed with no gutters -- and
#             shows up as fringing on every sprite. It is not clean pixel art:
#             it holds 169k distinct colours, so lossless was paying full price
#             for painted gradients and the file came to 852 KB, over half of
#             everything the game loads before its first frame.
#
#             near-lossless keeps the bleed argument intact while dropping that
#             to 460 KB. Measured per frame against the lossless original, over
#             every rect in game.json and ignoring transparent pixels, the worst
#             channel error anywhere is 8/255. Plain lossy is much smaller still
#             -- 335 KB at q95 -- but concentrates its error exactly where it is
#             visible, putting 83/255 into the hard edges of the UI icons.
#
#             -exact is deliberately absent: it preserves RGB underneath fully
#             transparent pixels, which nothing samples here because the game
#             renders with pixelArt (nearest-neighbour) filtering, and it costs
#             77 KB. Do not lower near-lossless below 20 without it, though --
#             at 10 and below the alpha handling breaks outright.
#
#   q90       Sprite sheets. Frames sit edge to edge with no gutter, so the same
#             bleed risk applies -- but this is soft painted effect art, where
#             q90 keeps the bleed under the threshold of visibility.
#
#   q85       Single painted images with alpha: the roster portraits and the
#             reveal panels. No frame boundaries to bleed across, but a hard
#             alpha edge that wants to stay clean.
#
#   q82       The full-screen backdrops. No alpha, no frames, nothing but
#             gradient -- the case WebP is best at and PNG is worst at. These
#             are the biggest files in the game and they compress to ~8%.
#
# font.png is deliberately left alone: it is a 984-byte bitmap font whose glyphs
# have to stay pixel-exact, and converting it would save nothing.
#
# Idempotent -- it skips a file whose .webp is already newer than its .png, so
# it is safe to re-run after the art pipeline regenerates a sheet.

set -euo pipefail

cd "$(dirname "$0")/.."
ASSETS=public/assets

command -v cwebp >/dev/null || { echo "cwebp not found -- brew install webp"; exit 1; }

# Files that must keep their PNG encoding entirely.
keep_png() { [[ "$1" == "$ASSETS/font.png" ]]; }

# Which quality class a given path belongs to.
classify() {
  local f=$1 base=${1#"$ASSETS/"}
  case "$base" in
    game.png)                                    echo near20 ;;
    tex/*|powerups/*|floor-*|ui/icon-*)          echo lossless ;;
    vfx/*|*-motion-*|samurai-ready.png)          echo q90 ;;
    arena-*|dojo-*)                              echo q82 ;;
    *)                                           echo q85 ;;
  esac
}

total_before=0 total_after=0 converted=0 skipped=0

while IFS= read -r png; do
  if keep_png "$png"; then continue; fi

  webp="${png%.png}.webp"
  before=$(stat -f%z "$png")

  if [[ -f "$webp" && "$webp" -nt "$png" ]]; then
    after=$(stat -f%z "$webp")
    skipped=$((skipped + 1))
  else
    case "$(classify "$png")" in
      lossless) cwebp -quiet -z 9 -exact "$png" -o "$webp" ;;
      near20)   cwebp -quiet -near_lossless 20 -z 9 -lossless "$png" -o "$webp" ;;
      q90)      cwebp -quiet -q 90 -alpha_q 100 "$png" -o "$webp" ;;
      q85)      cwebp -quiet -q 85 -alpha_q 100 "$png" -o "$webp" ;;
      q82)      cwebp -quiet -q 82 -alpha_q 100 "$png" -o "$webp" ;;
    esac
    after=$(stat -f%z "$webp")
    rm "$png"
    converted=$((converted + 1))
  fi

  total_before=$((total_before + before))
  total_after=$((total_after + after))
done < <(find "$ASSETS" -name '*.png' | sort)

printf '\n  %d converted, %d already current\n' "$converted" "$skipped"
printf '  %.2f MB -> %.2f MB (%d%% of original)\n\n' \
  "$(echo "$total_before/1048576" | bc -l)" \
  "$(echo "$total_after/1048576" | bc -l)" \
  "$((total_before > 0 ? 100 * total_after / total_before : 100))"
