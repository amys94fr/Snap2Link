"""
Generate the Snap2Link app icon (1024x1024 PNG source).
Concept: rounded blue→cyan gradient square with a dashed selection frame
inside, and a share arrow rising from its top-right corner.

Run:  py scripts/make_icon.py
Output: src-tauri/icons/source.png  (then `cargo tauri icon` to fan out sizes)
"""

from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

OUT_DIR = Path(__file__).resolve().parents[1] / "src-tauri" / "icons"
OUT_DIR.mkdir(parents=True, exist_ok=True)
OUT = OUT_DIR / "source.png"

S = 1024
PAD = int(S * 0.04)  # outer padding


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(len(a)))


def gradient_rounded_square(size, pad, radius_pct, color_a, color_b):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))

    # Build a vertical gradient on a rect, then mask it with a rounded mask
    rect = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    px = rect.load()
    for y in range(size):
        t = y / (size - 1)
        c = lerp(color_a, color_b, t) + (255,)
        for x in range(size):
            px[x, y] = c

    mask = Image.new("L", (size, size), 0)
    md = ImageDraw.Draw(mask)
    radius = int((size - 2 * pad) * radius_pct)
    md.rounded_rectangle(
        [pad, pad, size - pad, size - pad],
        radius=radius,
        fill=255,
    )

    img.paste(rect, (0, 0), mask)
    return img


def draw_dashed_rounded_rect(draw, box, radius, dash_len, gap_len, width, fill):
    """Approximate a dashed rounded rectangle by stroking many small segments."""
    x0, y0, x1, y1 = box
    # Top + bottom edges
    for y in (y0, y1):
        x = x0 + radius
        end = x1 - radius
        toggle = True
        while x < end:
            seg = min(dash_len if toggle else gap_len, end - x)
            if toggle:
                draw.rectangle([x, y - width / 2, x + seg, y + width / 2], fill=fill)
            x += seg
            toggle = not toggle
    # Left + right edges
    for x in (x0, x1):
        y = y0 + radius
        end = y1 - radius
        toggle = True
        while y < end:
            seg = min(dash_len if toggle else gap_len, end - y)
            if toggle:
                draw.rectangle([x - width / 2, y, x + width / 2, y + seg], fill=fill)
            y += seg
            toggle = not toggle
    # Corner arcs (solid for simplicity — they read as continuous, like a real selection cursor)
    for cx, cy, start, sweep in (
        (x0 + radius, y0 + radius, 180, 270),
        (x1 - radius, y0 + radius, 270, 360),
        (x1 - radius, y1 - radius, 0, 90),
        (x0 + radius, y1 - radius, 90, 180),
    ):
        draw.arc(
            [cx - radius, cy - radius, cx + radius, cy + radius],
            start=start,
            end=sweep,
            fill=fill,
            width=int(width),
        )


def draw_share_arrow(draw, cx, cy, size, fill, stroke_w):
    """Draw a circular share node + outgoing curved arrow rising up-right."""
    r = size
    # Filled circle "node"
    draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=fill)
    # Inner glyph: chain link (two interlocked rounded rects)
    link_w = int(r * 0.55)
    link_h = int(r * 0.34)
    bar_w = int(link_h * 0.30)
    glyph = (37, 99, 235, 255)  # blue-600
    # Two slightly overlapping pills, rotated 30°  → simulate via two ovals
    g_img = Image.new("RGBA", (r * 2, r * 2), (0, 0, 0, 0))
    gd = ImageDraw.Draw(g_img)
    gd.rounded_rectangle(
        [r - link_w, r - link_h // 2, r, r + link_h // 2],
        radius=link_h // 2,
        outline=glyph,
        width=bar_w,
    )
    gd.rounded_rectangle(
        [r, r - link_h // 2, r + link_w, r + link_h // 2],
        radius=link_h // 2,
        outline=glyph,
        width=bar_w,
    )
    g_img = g_img.rotate(-25, resample=Image.BICUBIC, center=(r, r))
    return g_img, (cx - r, cy - r)


def make_icon():
    blue_600 = (37, 99, 235)
    cyan_400 = (34, 211, 238)
    bg = gradient_rounded_square(S, PAD, radius_pct=0.22, color_a=blue_600, color_b=cyan_400)

    # Subtle inner highlight (top-left)
    highlight = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    hd = ImageDraw.Draw(highlight)
    hd.rounded_rectangle(
        [PAD + 2, PAD + 2, S - PAD - 2, int(S * 0.55)],
        radius=int((S - 2 * PAD) * 0.22),
        fill=(255, 255, 255, 32),
    )
    bg = Image.alpha_composite(bg, highlight)

    # Selection frame (dashed)
    frame = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    fd = ImageDraw.Draw(frame)
    fpad = int(S * 0.20)
    box = [fpad, int(S * 0.25), S - fpad, int(S * 0.78)]
    radius = int(S * 0.04)
    draw_dashed_rounded_rect(
        fd, box,
        radius=radius,
        dash_len=int(S * 0.045),
        gap_len=int(S * 0.022),
        width=int(S * 0.018),
        fill=(255, 255, 255, 255),
    )

    # Selection corner brackets (thicker, iconic)
    bracket_len = int(S * 0.10)
    bracket_w = int(S * 0.030)
    bw = bracket_w
    x0, y0, x1, y1 = box
    for (cx, cy, dx, dy) in [
        (x0, y0, +1, +1),
        (x1, y0, -1, +1),
        (x1, y1, -1, -1),
        (x0, y1, +1, -1),
    ]:
        # Horizontal stroke
        fd.rectangle(
            [
                cx if dx > 0 else cx - bracket_len,
                cy - bw // 2 if dy > 0 else cy - bw // 2,
                cx + bracket_len if dx > 0 else cx,
                cy + bw // 2 if dy > 0 else cy + bw // 2,
            ],
            fill=(255, 255, 255, 255),
        )
        # Vertical stroke
        fd.rectangle(
            [
                cx - bw // 2,
                cy if dy > 0 else cy - bracket_len,
                cx + bw // 2,
                cy + bracket_len if dy > 0 else cy,
            ],
            fill=(255, 255, 255, 255),
        )

    bg = Image.alpha_composite(bg, frame)

    # Share node (link icon) sitting on the top-right of the selection frame
    node_r = int(S * 0.10)
    node_cx = int(S * 0.78)
    node_cy = int(S * 0.30)
    node = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    nd = ImageDraw.Draw(node)
    # White circle with subtle drop shadow
    shadow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)
    sd.ellipse(
        [node_cx - node_r - 2, node_cy - node_r + 4, node_cx + node_r + 2, node_cy + node_r + 8],
        fill=(0, 0, 0, 70),
    )
    shadow = shadow.filter(ImageFilter.GaussianBlur(radius=8))
    bg = Image.alpha_composite(bg, shadow)
    nd.ellipse(
        [node_cx - node_r, node_cy - node_r, node_cx + node_r, node_cy + node_r],
        fill=(255, 255, 255, 255),
    )
    # Chain link glyph inside the node (two rounded bars at 25°)
    link_w = int(node_r * 1.05)
    link_h = int(node_r * 0.55)
    bar_w = int(link_h * 0.32)
    glyph = Image.new("RGBA", (node_r * 4, node_r * 4), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glyph)
    cx2 = node_r * 2
    cy2 = node_r * 2
    gd.rounded_rectangle(
        [cx2 - link_w + bar_w, cy2 - link_h // 2, cx2 + bar_w // 2, cy2 + link_h // 2],
        radius=link_h // 2,
        outline=(37, 99, 235, 255),
        width=bar_w,
    )
    gd.rounded_rectangle(
        [cx2 - bar_w // 2, cy2 - link_h // 2, cx2 + link_w - bar_w, cy2 + link_h // 2],
        radius=link_h // 2,
        outline=(37, 99, 235, 255),
        width=bar_w,
    )
    glyph = glyph.rotate(-30, resample=Image.BICUBIC, center=(cx2, cy2))
    node.paste(glyph, (node_cx - cx2, node_cy - cy2), glyph)

    bg = Image.alpha_composite(bg, node)

    # Soft overall outer glow on the rounded square edges (very subtle)
    bg.save(OUT, "PNG")
    print(f"Saved {OUT} ({S}x{S})")


if __name__ == "__main__":
    make_icon()
