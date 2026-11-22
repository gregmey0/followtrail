#!/usr/bin/env python3
"""Icône Follow Trail : un repère de position qui émet, au bout d'un sentier de montagne.
viewBox 108 = gabarit d'icône adaptative Android (zone sûre : disque de 66 au centre).
Produit les SVG, les PNG web et les ressources Android (rsvg-convert requis)."""
import pathlib, subprocess, shutil
from PIL import Image

HERE = pathlib.Path(__file__).parent
ROOT = HERE.parent.parent
RES = ROOT / "android/app/src/main/res"

BG = '''<defs>
 <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#101C2E"/><stop offset="0.65" stop-color="#2A3F5E"/><stop offset="1" stop-color="#5A4A62"/></linearGradient>
 <linearGradient id="far" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3E5674"/><stop offset="1" stop-color="#26374F"/></linearGradient>
</defs>
<rect width="108" height="108" fill="url(#sky)"/>
<path d="M0,64 L16,50 L28,58 L46,36 L58,48 L70,40 L84,52 L94,46 L108,58 L108,108 L0,108 Z" fill="url(#far)"/>
<path d="M46,36 L52,43 L49,44 L44,40 Z M70,40 L75,45 L72,45 Z" fill="#E8EEF5" opacity=".85"/>
<path d="M0,80 C20,68 36,66 56,72 C74,77 92,70 108,64 L108,108 L0,108 Z" fill="#17243A"/>'''

def pin(x, y, col, s=1.0):
    # repère de position (goutte) dont la pointe est en (x, y)
    return (f'<g transform="translate({x},{y}) scale({s})">'
            '<path d="M0,0 C-3,-6 -9,-10 -9,-17 A9,9 0 1,1 9,-17 C9,-10 3,-6 0,0 Z" fill="%s" stroke="#000" stroke-width="2.2" stroke-linejoin="round"/>'
            '<circle cx="0" cy="-17" r="3.6" fill="#fff" stroke="#000" stroke-width="1.2"/></g>') % col

# sentier qui monte vers le repère orange, ondes du partage en direct autour du repère
TRAIL = "M20,100 C32,90 30,84 40,79 C52,73 60,77 62,69 C63,65 58,63 60,61"
FG = (f'<path d="{TRAIL}" fill="none" stroke="#3A2A16" stroke-width="9" stroke-linecap="round"/>'
      f'<path d="{TRAIL}" fill="none" stroke="#F3DDB0" stroke-width="5" stroke-linecap="round"/>'
      '<path d="M49.3,33.5 A14,14 0 0,1 70.7,33.5" fill="none" stroke="#FF8A1F" stroke-width="3.6" stroke-linecap="round"/>'
      '<path d="M44.7,29.6 A20,20 0 0,1 75.3,29.6" fill="none" stroke="#FF8A1F" stroke-width="3.2" stroke-linecap="round" opacity=".6"/>'
      + pin(60, 62, '#FF8A1F', 1.15))

def svg(body, vb="0 0 108 108"):
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb}">{body}</svg>'

def render(src, out, w, h=None):
    subprocess.run(["rsvg-convert", "-w", str(w), "-h", str(h or w), "-o", str(out), str(src)], check=True)

if __name__ == "__main__":
    tmp = HERE / "_tmp"; tmp.mkdir(exist_ok=True)
    (tmp / "bg.svg").write_text(svg(BG)); (tmp / "fg.svg").write_text(svg(FG))
    web = svg(BG + FG, "12 12 84 84")
    (HERE / "icon.svg").write_text(web); (tmp / "web.svg").write_text(web)
    for n in (180, 192, 512):
        render(tmp / "web.svg", HERE / f"icon-{n}.png", n)
    # Android : icône adaptative (avant-plan + fond) et icônes classiques
    dens = {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}
    for d, k in dens.items():
        dd = RES / f"mipmap-{d}"
        render(tmp / "fg.svg", dd / "ic_launcher_foreground.png", int(108 * k))
        render(tmp / "bg.svg", dd / "ic_launcher_background.png", int(108 * k))
        n = int(48 * k)
        render(tmp / "web.svg", dd / "ic_launcher.png", n)
        im = Image.open(dd / "ic_launcher.png").convert("RGBA")
        mask = Image.new("L", im.size, 0)
        from PIL import ImageDraw
        ImageDraw.Draw(mask).ellipse((0, 0, n - 1, n - 1), fill=255)
        rnd = Image.new("RGBA", im.size, (0, 0, 0, 0)); rnd.paste(im, (0, 0), mask)
        rnd.save(dd / "ic_launcher_round.png")
    # écrans de démarrage : fond noir, icône au centre (mêmes dimensions que les fichiers existants)
    render(tmp / "web.svg", tmp / "big.png", 512)
    big = Image.open(tmp / "big.png").convert("RGBA")
    for f in RES.glob("drawable*/splash.png"):
        w, h = Image.open(f).size
        s = int(min(w, h) * 0.36)
        canvas = Image.new("RGB", (w, h), (11, 13, 11))
        ic = big.resize((s, s), Image.LANCZOS)
        canvas.paste(ic, ((w - s) // 2, (h - s) // 2), ic)
        canvas.save(f)
    shutil.rmtree(tmp)
    print("icônes générées")
