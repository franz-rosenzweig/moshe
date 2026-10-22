#!/usr/bin/env python3
"""Put together the public taste of Moshe: the real web app, running in the
browser on a made-up library, with a page around it.

    python3 tools/build_demo.py OUT_DIR

OUT_DIR gets the page (demo/index.html, taste.css, taste.js), the icon, a few
screenshots from docs/images as WebP (named by their content, so a changed one
gets a new name), and app/: the web app built from demo/app.html and
demo/boot.js (demo/vite.config.mjs), which keeps its library in the browser's
IndexedDB, plus library.json, the sample library made by demo/make-library.mjs.
Everything comes from this repository; no server, nothing private (the build
leaves out frontend/src/lib/private-themes/). Node runs in Docker (node:22), as
frontend/build.sh does, so the host needs Docker and Python with Pillow.
"""
import hashlib
import os
import shutil
import subprocess
import sys
from io import BytesIO
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
BUILT = ROOT / 'frontend' / 'dist-demo'
SHOTS = {  # name in the page: (docs image, crop to the third phone?)
    'translation': ('translation.png', False),
    'dashboard': ('dashboard.png', False),
    'export': ('export.png', False),
    'phones': ('phones.png', False),
    'phone': ('phones.png', True),
}


def node(cmd):
    uid = f'{os.getuid()}:{os.getgid()}'
    subprocess.run(['docker', 'run', '--rm', '-u', uid, '-e', 'HOME=/tmp', '-v', f'{ROOT}:/repo', '-w', '/repo',
                    'node:22', 'sh', '-c', cmd], check=True)


def third_phone(im):
    """The rightmost of the three phones in phones.png: the editor."""
    alpha = im.getchannel('A')
    w, h = im.size
    cols = [x for x in range(w) if alpha.crop((x, h // 2, x + 1, h // 2 + 1)).getpixel((0, 0)) > 128]
    runs, start, prev = [], None, None
    for x in cols:
        if start is None:
            start = x
        elif x != prev + 1:
            runs.append((start, prev))
            start = x
        prev = x
    runs.append((start, prev))
    a, b = runs[-1]
    box = im.crop((a, 0, b + 1, h))
    return box.crop(box.getchannel('A').point(lambda v: 255 if v > 128 else 0).getbbox())


def shot(out, name, src, crop):
    im = Image.open(ROOT / 'docs' / 'images' / src).convert('RGBA')
    if crop:
        im = third_phone(im)
    width = 600 if crop else 1200
    if im.width > width:
        im = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
    buf = BytesIO()
    im.save(buf, 'WEBP', quality=85, method=6)
    data = buf.getvalue()
    file = f'{name}-{hashlib.sha1(data).hexdigest()[:8]}.webp'
    (out / 'shots' / file).write_bytes(data)
    return file, im.size


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    out = Path(sys.argv[1]).resolve()
    out.mkdir(parents=True, exist_ok=True)

    if not (ROOT / 'frontend' / 'node_modules').is_dir():
        node('cd frontend && npm ci --no-audit --no-fund')
    node('cd frontend && npx vite build --config ../demo/vite.config.mjs --logLevel error'
         ' && cd .. && node demo/make-library.mjs --json frontend/dist-demo/library.json')
    for f in BUILT.rglob('*.js'):
        if 'private-themes' in f.read_text(errors='ignore'):
            sys.exit(f'refusing: {f} mentions private-themes')

    app = out / 'app'
    if app.exists():
        shutil.rmtree(app)
    shutil.copytree(BUILT, app)
    (app / 'app.html').rename(app / 'index.html')
    shutil.copy2(ROOT / 'frontend' / 'public' / 'icons' / 'icon.svg', app / 'icon.svg')
    shutil.copy2(ROOT / 'frontend' / 'public' / 'icons' / 'icon.svg', out / 'icon.svg')
    for f in ('taste.css', 'taste.js'):
        shutil.copy2(ROOT / 'demo' / f, out / f)

    (out / 'shots').mkdir(exist_ok=True)
    for old in (out / 'shots').glob('*.webp'):
        old.unlink()
    page = (ROOT / 'demo' / 'index.html').read_text()
    for name, (src, crop) in SHOTS.items():
        file, (w, h) = shot(out, name, src, crop)
        page = page.replace(f'{{{{shot:{name}}}}}', f'shots/{file}').replace(f'{{{{w:{name}}}}}', str(w)).replace(f'{{{{h:{name}}}}}', str(h))
    if '{{' in page:
        sys.exit('a placeholder in demo/index.html was left unfilled')
    (out / 'index.html').write_text(page)
    print(f'taste written to {out}')


if __name__ == '__main__':
    main()
