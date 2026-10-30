#!/usr/bin/env python3
"""Create an offline, self-contained HTML edition from the checked source."""
from argparse import ArgumentParser
from pathlib import Path

parser = ArgumentParser()
parser.add_argument('--output', required=True)
args = parser.parse_args()
root = Path(__file__).resolve().parent.parent
dist = root / 'dist'
html = (dist / 'index.html').read_text(encoding='utf-8')
css = (dist / 'style.css').read_text(encoding='utf-8')
html = html.replace('<link rel="stylesheet" href="style.css">', '<style>\n' + css + '\n</style>')
for name in ['engine.js', 'app.js']:
    script = (dist / name).read_text(encoding='utf-8')
    if '</script' in script.lower():
        raise ValueError(f'Unexpected script end marker in {name}')
    html = html.replace(f'<script src="{name}"></script>', '<script>\n' + script + '\n</script>')
assert 'src="engine.js"' not in html and 'src="app.js"' not in html
assert 'href="style.css"' not in html
target = Path(args.output).resolve()
target.parent.mkdir(parents=True, exist_ok=True)
target.write_text(html, encoding='utf-8')
print(f'Offline HTML: {target} ({target.stat().st_size:,} bytes)')
