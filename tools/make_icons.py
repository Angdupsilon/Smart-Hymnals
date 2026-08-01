#!/usr/bin/env python3
"""Generate the extension icons.

Draws a two-column "parallel text" mark -- an indigo tile with a column of
white lines beside a column of pale-blue lines -- at 512px, then box-filters it
down to each size the manifest asks for. Pure standard library, no Pillow.

Run from the repo root:  python3 tools/make_icons.py
"""

import os
import struct
import zlib

SUPER = 512
SIZES = (16, 32, 48, 128)
OUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "icons")

BG = (91, 79, 233, 255)        # #5B4FE9, the site's nav indigo
LEFT_BAR = (255, 255, 255, 255)
RIGHT_BAR = (168, 230, 255, 255)
TRANSPARENT = (0, 0, 0, 0)

RADIUS = 96


def blank(size):
    return [[TRANSPARENT for _ in range(size)] for _ in range(size)]


def fill_rounded_rect(px, x0, y0, x1, y1, radius, color):
    """Filled rectangle with quarter-circle corners."""
    for y in range(y0, y1):
        for x in range(x0, x1):
            cx = cy = None
            if x < x0 + radius and y < y0 + radius:
                cx, cy = x0 + radius, y0 + radius
            elif x >= x1 - radius and y < y0 + radius:
                cx, cy = x1 - radius - 1, y0 + radius
            elif x < x0 + radius and y >= y1 - radius:
                cx, cy = x0 + radius, y1 - radius - 1
            elif x >= x1 - radius and y >= y1 - radius:
                cx, cy = x1 - radius - 1, y1 - radius - 1

            if cx is not None:
                if (x - cx) ** 2 + (y - cy) ** 2 > radius * radius:
                    continue
            px[y][x] = color


def draw():
    px = blank(SUPER)
    fill_rounded_rect(px, 0, 0, SUPER, SUPER, RADIUS, BG)

    bar_h = 30
    gap = 26
    top = 116
    rows = 5

    left_x0, left_x1 = 78, 238
    right_x0, right_x1 = 274, 434

    for r in range(rows):
        y0 = top + r * (bar_h + gap)
        y1 = y0 + bar_h
        # Last line of each column is short, the way a stanza's final line runs out.
        lx1 = left_x1 - (52 if r == rows - 1 else 0)
        rx1 = right_x1 - (78 if r == rows - 1 else 0)
        fill_rounded_rect(px, left_x0, y0, lx1, y1, bar_h // 2, LEFT_BAR)
        fill_rounded_rect(px, right_x0, y0, rx1, y1, bar_h // 2, RIGHT_BAR)

    return px


def downsample(px, size):
    """Box filter from SUPER to size, averaging in premultiplied alpha."""
    factor = SUPER // size
    out = blank(size)
    area = factor * factor
    for y in range(size):
        for x in range(size):
            r = g = b = a = 0
            for sy in range(y * factor, (y + 1) * factor):
                row = px[sy]
                for sx in range(x * factor, (x + 1) * factor):
                    pr, pg, pb, pa = row[sx]
                    r += pr * pa
                    g += pg * pa
                    b += pb * pa
                    a += pa
            if a:
                out[y][x] = (r // a, g // a, b // a, a // area)
            else:
                out[y][x] = TRANSPARENT
    return out


def write_png(path, px):
    size = len(px)
    raw = bytearray()
    for row in px:
        raw.append(0)  # filter type 0
        for r, g, b, a in row:
            raw += bytes((r, g, b, a))

    def chunk(tag, data):
        out = struct.pack(">I", len(data)) + tag + data
        return out + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(bytes(raw), 9))
    png += chunk(b"IEND", b"")

    with open(path, "wb") as fh:
        fh.write(png)


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    master = draw()
    for size in SIZES:
        path = os.path.join(OUT_DIR, "icon%d.png" % size)
        write_png(path, downsample(master, size))
        print("wrote", path)


if __name__ == "__main__":
    main()
