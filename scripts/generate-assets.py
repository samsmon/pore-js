import os
from PIL import Image, ImageDraw

base_dir = os.path.expanduser('~/Documents/GitHub/pore-js')
assets_dir = os.path.join(base_dir, 'assets')
public_dir = os.path.join(base_dir, 'apps', 'demo', 'public')

os.makedirs(assets_dir, exist_ok=True)
os.makedirs(public_dir, exist_ok=True)

logo_svg = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="100%" height="100%">
  <defs>
    <linearGradient id="plateGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#242119" />
      <stop offset="100%" stop-color="#14120e" />
    </linearGradient>
    <linearGradient id="leftPage" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#ffffff" />
      <stop offset="100%" stop-color="#ede6d8" />
    </linearGradient>
    <linearGradient id="rightPage" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#f5efe6" />
      <stop offset="100%" stop-color="#dfd6c5" />
    </linearGradient>
    <linearGradient id="amberGlow" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#fbbf24" />
      <stop offset="100%" stop-color="#d97706" />
    </linearGradient>
    <filter id="softShadow" x="-10%" y="-10%" width="130%" height="130%">
      <feDropShadow dx="0" dy="8" stdDeviation="10" flood-color="#000000" flood-opacity="0.35" />
    </filter>
  </defs>

  <!-- Base rounded plate -->
  <rect x="12" y="12" width="232" height="232" rx="52" fill="url(#plateGrad)" stroke="#383327" stroke-width="2.5" filter="url(#softShadow)" />

  <!-- Stylized Open Book Folio -->
  <!-- Left Page -->
  <path d="M128 184 C100 178 64 186 46 194 C42 196 38 193 38 188 L38 78 C38 74 42 71 46 69 C68 60 102 54 128 66 Z" 
        fill="url(#leftPage)" />
  
  <!-- Right Page -->
  <path d="M128 184 C156 178 192 186 210 194 C214 196 218 193 218 188 L218 78 C218 74 214 71 210 69 C188 60 154 54 128 66 Z" 
        fill="url(#rightPage)" />

  <!-- Center Spine Seam -->
  <path d="M128 66 L128 184" stroke="#8a7f6c" stroke-width="3" stroke-linecap="round" />

  <!-- Central Reading Aperture / Pore Focus Ring -->
  <circle cx="128" cy="124" r="26" fill="#1c1a14" stroke="url(#amberGlow)" stroke-width="4" />
  <circle cx="128" cy="124" r="12" fill="url(#amberGlow)" />

  <!-- Minimalist reading lines on pages -->
  <line x1="62" y1="98" x2="104" y2="94" stroke="#a39a89" stroke-width="2.5" stroke-linecap="round" opacity="0.6" />
  <line x1="62" y1="120" x2="100" y2="117" stroke="#a39a89" stroke-width="2.5" stroke-linecap="round" opacity="0.6" />
  <line x1="62" y1="142" x2="106" y2="140" stroke="#a39a89" stroke-width="2.5" stroke-linecap="round" opacity="0.6" />

  <line x1="152" y1="94" x2="194" y2="98" stroke="#a39a89" stroke-width="2.5" stroke-linecap="round" opacity="0.6" />
  <line x1="156" y1="117" x2="194" y2="120" stroke="#a39a89" stroke-width="2.5" stroke-linecap="round" opacity="0.6" />
  <line x1="150" y1="140" x2="194" y2="142" stroke="#a39a89" stroke-width="2.5" stroke-linecap="round" opacity="0.6" />
</svg>"""

favicon_svg = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs>
    <linearGradient id="favPlate" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#242119" />
      <stop offset="100%" stop-color="#12110d" />
    </linearGradient>
    <linearGradient id="favAmber" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#fbbf24" />
      <stop offset="100%" stop-color="#d97706" />
    </linearGradient>
  </defs>
  <rect width="64" height="64" rx="16" fill="url(#favPlate)" stroke="#383327" stroke-width="1.5" />
  <!-- Left Leaf -->
  <path d="M32 46 C25 44 16 46 11 48 C10 48.5 9 47.8 9 46.5 L9 19 C9 18 10 17.2 11 16.8 C17 14.5 25 13 32 16 Z" fill="#faf7f1" />
  <!-- Right Leaf -->
  <path d="M32 46 C39 44 48 46 53 48 C54 48.5 55 47.8 55 46.5 L55 19 C55 18 54 17.2 53 16.8 C47 14.5 39 13 32 16 Z" fill="#ede6d8" />
  <!-- Center seam -->
  <line x1="32" y1="16" x2="32" y2="46" stroke="#8a7f6c" stroke-width="1.5" stroke-linecap="round" />
  <!-- Aperture / Pore dot -->
  <circle cx="32" cy="31" r="7" fill="#17150f" stroke="url(#favAmber)" stroke-width="1.8" />
  <circle cx="32" cy="31" r="3.5" fill="url(#favAmber)" />
</svg>"""

with open(os.path.join(assets_dir, 'logo.svg'), 'w', encoding='utf-8') as f:
    f.write(logo_svg)

with open(os.path.join(public_dir, 'favicon.svg'), 'w', encoding='utf-8') as f:
    f.write(favicon_svg)

# Render raster PNGs using Pillow
size = 512
img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
draw = ImageDraw.Draw(img)

# Rounded plate
plate_box = [20, 20, size - 20, size - 20]
draw.rounded_rectangle(plate_box, radius=110, fill=(24, 22, 17, 255), outline=(56, 51, 39, 255), width=6)

# Left page
left_page = [
    (256, 368),
    (200, 356),
    (128, 372),
    (92, 388),
    (76, 388),
    (76, 156),
    (92, 138),
    (136, 120),
    (200, 108),
    (256, 132),
]
draw.polygon(left_page, fill=(250, 247, 241, 255))

# Right page
right_page = [
    (256, 368),
    (312, 356),
    (384, 372),
    (420, 388),
    (436, 388),
    (436, 156),
    (420, 138),
    (376, 120),
    (312, 108),
    (256, 132),
]
draw.polygon(right_page, fill=(237, 230, 216, 255))

# Center seam
draw.line([(256, 132), (256, 368)], fill=(138, 127, 108, 255), width=7)

# Central aperture ring
center_x, center_y = 256, 248
r_outer = 54
draw.ellipse([center_x - r_outer, center_y - r_outer, center_x + r_outer, center_y + r_outer], fill=(28, 26, 20, 255), outline=(217, 119, 6, 255), width=8)

r_inner = 26
draw.ellipse([center_x - r_inner, center_y - r_inner, center_x + r_inner, center_y + r_inner], fill=(245, 158, 11, 255))

# Page lines
for y_off in [196, 248, 300]:
    draw.line([(124, y_off), (208, y_off - 6)], fill=(163, 154, 137, 160), width=5)
    draw.line([(304, y_off - 6), (388, y_off)], fill=(163, 154, 137, 160), width=5)

# Save icons
apple_icon = img.resize((180, 180), Image.Resampling.LANCZOS)
apple_icon.save(os.path.join(public_dir, 'apple-touch-icon.png'))

fav_32 = img.resize((32, 32), Image.Resampling.LANCZOS)
fav_32.save(os.path.join(public_dir, 'favicon-32x32.png'))
fav_32.save(os.path.join(public_dir, 'favicon.ico'))

print('Generated logo.svg, favicon.svg, apple-touch-icon.png, favicon.ico successfully')
