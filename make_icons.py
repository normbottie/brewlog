"""Generate Brewlog app icons (dark coffee ground + tan bean mark)."""
from PIL import Image, ImageDraw, ImageChops, ImageFilter
import math, os

OUT = os.path.join(os.path.dirname(__file__), "icons")
os.makedirs(OUT, exist_ok=True)

W = 1024      # master size
SS = 3        # supersample factor for the bean


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def bean_layer(bw, bh):
    """Tan ellipse with a tapered crease, drawn supersampled and clipped."""
    w, h = int(bw * SS), int(bh * SS)
    pad = int(max(w, h) * 0.06)
    layer = Image.new("RGBA", (w + pad * 2, h + pad * 2), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)

    box = [pad, pad, pad + w, pad + h]
    d.ellipse(box, fill=(230, 202, 158, 255))

    # subtle top-left lighting on the bean
    shade = Image.new("L", layer.size, 0)
    sd = ImageDraw.Draw(shade)
    sd.ellipse([pad + w * 0.16, pad + h * 0.2, pad + w * 1.1, pad + h * 1.25], fill=70)
    shade = shade.filter(ImageFilter.GaussianBlur(w / 14))
    dark = Image.new("RGBA", layer.size, (150, 112, 70, 255))
    layer = Image.composite(dark, layer, shade).convert("RGBA")
    # restore alpha outside the ellipse
    a = Image.new("L", layer.size, 0)
    ImageDraw.Draw(a).ellipse(box, fill=255)
    layer.putalpha(a)

    # crease: sine spine, thickness tapering to points at both ends
    n = 300
    top, bot = [], []
    half = h * 0.075
    for i in range(n + 1):
        t = i / n
        x = pad + w * (0.015 + 0.97 * t)
        y = pad + h * (0.5 + 0.26 * math.sin((t - 0.5) * math.pi * 1.08))
        taper = math.sin(math.pi * t) ** 0.55
        top.append((x, y - half * taper))
        bot.append((x, y + half * taper))
    crease = Image.new("RGBA", layer.size, (0, 0, 0, 0))
    ImageDraw.Draw(crease).polygon(top + bot[::-1], fill=(30, 23, 18, 255))
    crease.putalpha(ImageChops.multiply(crease.split()[3], a))
    layer.alpha_composite(crease)

    return layer.resize((int(bw * 1.12), int(bh * 1.12)), Image.LANCZOS)


def master(maskable=False):
    img = Image.new("RGB", (W, W))
    d = ImageDraw.Draw(img)
    top, bot = (40, 30, 23), (10, 8, 7)
    for y in range(W):
        d.line([(0, y), (W, y)], fill=lerp(top, bot, (y / W) ** 0.8))

    glow = Image.new("RGB", (W // 4, W // 4), (0, 0, 0))
    gd = ImageDraw.Draw(glow)
    cx, cy, R = W * 0.075, W * 0.06, W * 0.12
    gd.ellipse([cx - R, cy - R, cx + R, cy + R], fill=(88, 66, 42))
    glow = glow.filter(ImageFilter.GaussianBlur(W / 24)).resize((W, W), Image.BICUBIC)
    img = ImageChops.add(img, glow).convert("RGBA")

    scale = 0.50 if maskable else 0.62
    bean = bean_layer(W * scale, W * scale * 0.70)
    bean = bean.rotate(36, resample=Image.BICUBIC, expand=True)

    shadow = Image.new("RGBA", bean.size, (0, 0, 0, 0))
    shadow.paste((0, 0, 0, 130), (0, 0), bean.split()[3])
    shadow = shadow.filter(ImageFilter.GaussianBlur(W / 40))

    pos = (int((W - bean.width) / 2), int((W - bean.height) / 2))
    img.alpha_composite(shadow, (pos[0], pos[1] + int(W * 0.02)))
    img.alpha_composite(bean, pos)
    return img.convert("RGB")


def rounded(img, radius_frac=0.225):
    size = img.width
    m = Image.new("L", (size * 4, size * 4), 0)
    ImageDraw.Draw(m).rounded_rectangle(
        [0, 0, size * 4 - 1, size * 4 - 1], radius=int(size * 4 * radius_frac), fill=255
    )
    m = m.resize((size, size), Image.LANCZOS)
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(img.convert("RGB"), (0, 0), m)
    return out


sq = master()
mk = master(maskable=True)

for s in (192, 512):
    sq.resize((s, s), Image.LANCZOS).save(f"{OUT}/icon-{s}.png")
    mk.resize((s, s), Image.LANCZOS).save(f"{OUT}/maskable-{s}.png")

sq.resize((180, 180), Image.LANCZOS).save(f"{OUT}/icon-180.png")
rounded(sq).resize((32, 32), Image.LANCZOS).save(f"{OUT}/favicon-32.png")
print("icons written")
