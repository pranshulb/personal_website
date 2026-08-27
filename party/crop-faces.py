#!/usr/bin/env python3
"""Turn raw photos into square, face-centred, party-coloured bubble textures.

Two kinds of source:
  * cut-outs (PNG with alpha) -> composited straight onto a flat party colour
  * ordinary photos (JPG)     -> cropped tight, then the rim is melted into a
                                 party colour so every bubble still reads as a
                                 clean sticker instead of a busy background

Add a line to SHOTS and re-run. Output: images/pranshul-NN.jpg @ 1024².
"""
from PIL import Image, ImageEnhance, ImageDraw, ImageFilter
import os

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "images")
SIZE = 1024

CUTOUTS = "/var/www/arg/discord-claude/workspace/downloads/pranshul_photos"
PHOTOS = ("/var/www/arg/discord-claude/workspace/servers/1463565743567274175"
          "/groups/scientia/images/xi_2026-08-07")

# vibrant sticker palette
PINK, TANG, SUN = (255, 61, 139), (255, 138, 61), (255, 210, 61)
MINT, SKY, GRAPE = (61, 224, 160), (61, 187, 255), (164, 92, 255)
CORAL, TEAL = (255, 92, 92), (43, 212, 196)

# (dir, file, face centre x frac, face centre y frac, square side / width, backdrop)
SHOTS = [
    # --- background-removed cut-outs -------------------------------------
    (CUTOUTS, "pranshul_photo_1.png", 0.300, 0.400, 1.36, PINK),
    (CUTOUTS, "pranshul_photo_2.png", 0.476, 0.357, 0.88, SUN),
    (CUTOUTS, "pranshul_photo_3.png", 0.452, 0.352, 1.22, SKY),
    (CUTOUTS, "pranshul_photo_4.png", 0.340, 0.250, 1.02, MINT),
    (CUTOUTS, "pranshul_photo_5.png", 0.524, 0.430, 1.18, TANG),
    (CUTOUTS, "pranshul_photo_6.png", 0.524, 0.325, 1.02, GRAPE),
    # --- ordinary photos, rim melted into colour -------------------------
    (PHOTOS, "image_01.jpg", 0.467, 0.413, 0.96, TEAL),
    (PHOTOS, "image_02.jpg", 0.517, 0.413, 1.04, CORAL),
    (PHOTOS, "image_03.jpg", 0.533, 0.475, 0.98, SUN),
    (PHOTOS, "image_04.jpg", 0.517, 0.588, 0.81, GRAPE),
    (PHOTOS, "image_05.jpg", 0.400, 0.613, 0.75, MINT),
    (PHOTOS, "image_06.jpg", 0.367, 0.475, 0.75, PINK),
    (PHOTOS, "image_07.jpg", 0.517, 0.493, 0.65, SKY),
]


def radial_fade_mask(side, inner=0.62, outer=0.98):
    """White in the middle, fading to black past `outer` — melts the photo's
    background into the flat party colour toward the rim."""
    m = Image.new("L", (side, side), 0)
    d = ImageDraw.Draw(m)
    steps = 56
    for i in range(steps - 1, -1, -1):
        f = i / (steps - 1)
        r = (inner + (outer - inner) * f) * side / 2
        v = int(255 * (1 - f) ** 1.5)
        d.ellipse([side / 2 - r, side / 2 - r, side / 2 + r, side / 2 + r], fill=v)
    r0 = inner * side / 2
    d.ellipse([side / 2 - r0, side / 2 - r0, side / 2 + r0, side / 2 + r0], fill=255)
    return m.filter(ImageFilter.GaussianBlur(side / 55))


os.makedirs(OUT, exist_ok=True)
for i, (src, name, fx, fy, s, bg) in enumerate(SHOTS, 1):
    im = Image.open(os.path.join(src, name))
    has_alpha = im.mode in ("RGBA", "LA") or "transparency" in im.info
    im = im.convert("RGBA")
    W, H = im.size

    side = int(s * W)
    cx, cy = int(fx * W), int(fy * H)
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    canvas.paste(im.crop((cx - side // 2, cy - side // 2, cx + side // 2, cy + side // 2)), (0, 0))

    back = Image.new("RGB", (side, side), tuple(min(255, c + 20) for c in bg))
    out = Image.alpha_composite(back.convert("RGBA"), canvas).convert("RGB")

    if not has_alpha:
        out = Image.composite(out, back, radial_fade_mask(side))

    out = out.resize((SIZE, SIZE), Image.LANCZOS)

    # phone photos are dim and the refraction eats light — pre-brighten
    out = ImageEnhance.Brightness(out).enhance(1.16)
    out = ImageEnhance.Contrast(out).enhance(1.08)
    out = ImageEnhance.Color(out).enhance(1.18)

    dest = os.path.join(OUT, f"pranshul-{i:02d}.jpg")
    out.save(dest, "JPEG", quality=88, optimize=True)
    print(f"{name:24s} -> {os.path.basename(dest)}  ({os.path.getsize(dest)//1024}kb)")
