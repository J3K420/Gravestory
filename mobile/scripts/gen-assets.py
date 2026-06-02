"""
Generate GraveStory branded PNG assets for Expo.
Run from the repo root: python mobile/scripts/gen-assets.py
"""
from PIL import Image, ImageDraw, ImageFont
import os, math

ASSETS = os.path.join(os.path.dirname(__file__), '..', 'assets')

BG_COLOR      = (13, 11, 8)        # #0d0b08
GOLD          = (201, 168, 76)     # #c9a84c
GOLD_DIM      = (138, 111, 58)     # gradient end / faint strokes
PARCHMENT     = (232, 212, 160)    # #e8d4a0
BOOK_FILL     = (46, 37, 20)       # rgba(180,145,80,0.18) on dark bg

FONT_PATHS = [
    r"C:\Windows\Fonts\georgia.ttf",
    r"C:\Windows\Fonts\Georgiab.ttf",
    r"C:\Windows\Fonts\times.ttf",
    r"C:\Windows\Fonts\timesbd.ttf",
]

def load_font(size):
    for p in FONT_PATHS:
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def draw_logo(draw, ox, oy, scale, stroke_color=GOLD, faint_color=GOLD_DIM,
              book_fill=BOOK_FILL, stroke_w=1.5):
    """
    Render the gravestone logo onto `draw`.
    SVG viewBox is 0 0 100 112.  ox/oy are pixel offsets; scale maps SVG units → px.
    """
    def sx(x): return int(ox + x * scale)
    def sy(y): return int(oy + y * scale)
    lw  = max(1, round(stroke_w * scale))
    lw2 = max(1, round(1.8 * scale))
    lw3 = max(1, round(1.2 * scale))
    lws = max(1, round(0.8 * scale))

    # ── Base ledger ──────────────────────────────────────────────────
    draw.rectangle([sx(22), sy(84), sx(78), sy(90)],
                   outline=stroke_color, width=lw)

    # ── Tablet outline  M30 84  L30 35  Q30 18 50 18  Q70 18 70 35  L70 84 Z ──
    stone_l, stone_r  = sx(30), sx(70)
    stone_bottom      = sy(84)
    stone_arch_bot    = sy(35)
    stone_top         = sy(18)

    # Vertical sides
    draw.line([(stone_l, stone_arch_bot), (stone_l, stone_bottom)],
              fill=stroke_color, width=lw)
    draw.line([(stone_r, stone_arch_bot), (stone_r, stone_bottom)],
              fill=stroke_color, width=lw)
    # Bottom edge
    draw.line([(stone_l, stone_bottom), (stone_r, stone_bottom)],
              fill=stroke_color, width=lw)
    # Rounded arch: arc on an ellipse whose top is stone_top, whose horizontal
    # radius spans stone_l→stone_r, and whose vertical radius reflects stone_arch_bot.
    arch_bbox = [stone_l, stone_top, stone_r,
                 stone_arch_bot + (stone_arch_bot - stone_top)]
    draw.arc(arch_bbox, start=180, end=0, fill=stroke_color, width=lw)

    # ── Inner inscription border  M36 80  L36 38  Q36 24 50 24  Q64 24 64 38  L64 80 ──
    in_l, in_r    = sx(36), sx(64)
    in_bottom     = sy(80)
    in_arch_bot   = sy(38)
    in_top        = sy(24)

    draw.line([(in_l, in_arch_bot), (in_l, in_bottom)],
              fill=faint_color, width=max(1, lw - 1))
    draw.line([(in_r, in_arch_bot), (in_r, in_bottom)],
              fill=faint_color, width=max(1, lw - 1))
    arch_bbox2 = [in_l, in_top, in_r,
                  in_arch_bot + (in_arch_bot - in_top)]
    draw.arc(arch_bbox2, start=180, end=0, fill=faint_color, width=max(1, lw - 1))

    # ── Left book page  M38 40  L38 56  Q44 54 49 56  L49 42  Q44 40 38 40 Z ──
    lp = [(sx(38), sy(40)), (sx(38), sy(56)), (sx(49), sy(56)), (sx(49), sy(42))]
    draw.polygon(lp, fill=book_fill, outline=stroke_color)

    # ── Right book page  M51 42  Q56 40 62 40  L62 56  Q56 54 51 56 Z ──
    rp = [(sx(51), sy(42)), (sx(62), sy(40)), (sx(62), sy(56)), (sx(51), sy(56))]
    draw.polygon(rp, fill=book_fill, outline=stroke_color)

    # ── Book spine ──
    draw.line([(sx(50), sy(41)), (sx(50), sy(56))], fill=stroke_color, width=lw3)

    # ── Page lines ──
    for y in [44, 47, 50]:
        draw.line([(sx(40), sy(y)), (sx(47), sy(y))], fill=faint_color, width=lws)
        draw.line([(sx(53), sy(y)), (sx(60), sy(y))], fill=faint_color, width=lws)

    # ── Ground line ──
    draw.line([(sx(18), sy(92)), (sx(82), sy(92))], fill=faint_color, width=lw)


# ════════════════════════════════════════════════════════════════════
#  1. splash.png  —  1284 x 2778  (iPhone 14 Pro Max)
# ════════════════════════════════════════════════════════════════════
def make_splash():
    W, H = 1284, 2778
    img = Image.new('RGB', (W, H), BG_COLOR)
    draw = ImageDraw.Draw(img)

    # Logo: 420px wide, centered, upper-middle of screen
    scale = 420 / 100          # SVG viewBox is 100 units wide
    logo_h = int(112 * scale)
    ox = (W - 420) // 2
    oy = int(H * 0.30)         # top of logo at 30% down

    draw_logo(draw, ox, oy, scale)

    # Wordmark "GraveStory"
    font_lg = load_font(128)
    font_sm = load_font(48)

    text = "GraveStory"
    bb = draw.textbbox((0, 0), text, font=font_lg)
    tw, th = bb[2] - bb[0], bb[3] - bb[1]
    tx = (W - tw) // 2
    ty = oy + logo_h + 60
    draw.text((tx, ty), text, font=font_lg, fill=PARCHMENT)

    # Tagline
    tagline = "Every Stone Has a Story"
    bb2 = draw.textbbox((0, 0), tagline, font=font_sm)
    tw2 = bb2[2] - bb2[0]
    draw.text(((W - tw2) // 2, ty + th + 28), tagline, font=font_sm, fill=GOLD_DIM)

    out = os.path.join(ASSETS, 'splash.png')
    img.save(out, 'PNG')
    print(f"  OK  splash.png  ({W}x{H})")


# ════════════════════════════════════════════════════════════════════
#  2. icon.png  —  1024 x 1024
# ════════════════════════════════════════════════════════════════════
def make_icon():
    S = 1024
    img = Image.new('RGB', (S, S), BG_COLOR)
    draw = ImageDraw.Draw(img)

    # Logo fills ~78% of the icon with equal margins
    scale = (S * 0.78) / 100
    logo_h = int(112 * scale)
    ox = int((S - 100 * scale) / 2)
    oy = int((S - logo_h) / 2)

    draw_logo(draw, ox, oy, scale)

    out = os.path.join(ASSETS, 'icon.png')
    img.save(out, 'PNG')
    print(f"  OK  icon.png  ({S}x{S})")


# ════════════════════════════════════════════════════════════════════
#  3. android-icon-foreground.png  —  1024 x 1024, RGBA transparent bg
# ════════════════════════════════════════════════════════════════════
def make_android_foreground():
    S = 1024
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # The adaptive icon "safe zone" is the inner 66% of the canvas
    # Logo fills ~52% of total canvas to stay well inside safe zone
    scale = (S * 0.52) / 100
    logo_h = int(112 * scale)
    ox = int((S - 100 * scale) / 2)
    oy = int((S - logo_h) / 2)

    draw_logo(draw, ox, oy, scale,
              stroke_color=GOLD,
              faint_color=GOLD_DIM,
              book_fill=(180, 145, 80, 46))   # RGBA with alpha

    out = os.path.join(ASSETS, 'android-icon-foreground.png')
    img.save(out, 'PNG')
    print(f"  OK  android-icon-foreground.png  ({S}x{S}, RGBA)")


# ════════════════════════════════════════════════════════════════════
#  4. android-icon-background.png  —  1024 x 1024, solid dark
# ════════════════════════════════════════════════════════════════════
def make_android_background():
    S = 1024
    img = Image.new('RGB', (S, S), BG_COLOR)
    out = os.path.join(ASSETS, 'android-icon-background.png')
    img.save(out, 'PNG')
    print(f"  OK  android-icon-background.png  ({S}x{S})")


# ════════════════════════════════════════════════════════════════════
#  5. android-icon-monochrome.png  —  1024 x 1024, white on transparent
# ════════════════════════════════════════════════════════════════════
def make_android_monochrome():
    S = 1024
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    WHITE = (255, 255, 255)
    scale = (S * 0.52) / 100
    logo_h = int(112 * scale)
    ox = int((S - 100 * scale) / 2)
    oy = int((S - logo_h) / 2)

    draw_logo(draw, ox, oy, scale,
              stroke_color=WHITE,
              faint_color=(200, 200, 200),
              book_fill=(255, 255, 255, 46))

    out = os.path.join(ASSETS, 'android-icon-monochrome.png')
    img.save(out, 'PNG')
    print(f"  OK  android-icon-monochrome.png  ({S}x{S}, RGBA)")


if __name__ == '__main__':
    print("Generating GraveStory assets…")
    make_splash()
    make_icon()
    make_android_foreground()
    make_android_background()
    make_android_monochrome()
    print("Done.")
