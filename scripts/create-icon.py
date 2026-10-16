"""Build the FundWork vector mark and Windows icon from shared geometry."""
from pathlib import Path
from PIL import Image, ImageDraw
import math

OUT = Path(__file__).resolve().parents[1] / 'assets'
OUT.mkdir(exist_ok=True)
S = 1024
im = Image.new('RGBA', (S, S))
mask = Image.new('L', (S, S))
ImageDraw.Draw(mask).rounded_rectangle((32, 32, 992, 992), radius=218, fill=255)
pixels = im.load()
for y in range(S):
    for x in range(S):
        t = min(1, max(0, (x * .40 + y * .60) / S))
        a, b = (56, 189, 248), (27, 56, 169)
        pixels[x, y] = tuple(round(a[i] + (b[i]-a[i])*t) for i in range(3)) + (255,)
im.putalpha(mask)
d = ImageDraw.Draw(im)
f = [(232,238),(698,238),(698,352),(366,352),(366,460),(592,460),(592,574),(366,574),(366,790),(232,790)]
d.polygon(f, fill='white')
gear = []
for i in range(48):
    angle = math.pi*2*i/48 - math.pi/2
    radius = 188 if i%4 in (1,2) else 154
    gear.append((round(704+math.cos(angle)*radius), round(696+math.sin(angle)*radius)))
d.polygon(gear, fill='#e2efff', outline='#1e4aa4', width=14)
d.ellipse((641,633,767,759), fill='#245ed0')
im.save(OUT / 'fundwork-logo.png')
im.save(OUT / 'fundwork.ico', sizes=[(16,16),(24,24),(32,32),(48,48),(64,64),(128,128),(256,256)])
svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" role="img" aria-label="FundWork F and gear logo">
<defs><linearGradient id="blue" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#38bdf8"/><stop offset=".55" stop-color="#2875ed"/><stop offset="1" stop-color="#1b38a9"/></linearGradient></defs>
<rect x="32" y="32" width="960" height="960" rx="218" fill="url(#blue)"/>
<polygon points="{' '.join(f'{x},{y}' for x,y in f)}" fill="white"/>
<polygon points="{' '.join(f'{x},{y}' for x,y in gear)}" fill="#e2efff" stroke="#1e4aa4" stroke-width="14" stroke-linejoin="round"/>
<circle cx="704" cy="696" r="63" fill="#245ed0"/></svg>'''
(OUT / 'fundwork-logo.svg').write_text(svg)
print('Created SVG, 1024px PNG, and multi-resolution ICO')
