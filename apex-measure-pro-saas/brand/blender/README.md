# Rendering the Apex Point

`apex_point.py` builds the sculpture from the geometry of `brand/mark-on-dark.svg` (parametric,
deterministic) and renders with Cycles on the CPU. Tested with Blender 5.0.1 (`pip install bpy`).
It should also run in Blender 4.2+ from the desktop app.

```sh
# stills
python apex_point.py --mode hero --out ../renders/hero-3d-2400x1120.png --samples 96
python apex_point.py --mode icon --out ../renders/icon-3d-1024.png --samples 128
# or with the Blender app: blender -b -P apex_point.py -- --mode hero --out hero.png

# loop (96 PNG frames, one exact period, seamless), then encode
python apex_point.py --mode loop --out frames --scale 0.75 --samples 24
ffmpeg -framerate 24 -i frames/f%03d.png -c:v libvpx-vp9 -b:v 0 -crf 40 -pix_fmt yuv420p -an ../renders/hero-loop.webm

# webp stills
cwebp -q 82 ../renders/hero-3d-2400x1120.png -o ../renders/hero-3d-2400x1120.webp
```

Tweak look in the parameter block at the top (`DEPTH`, `BEVEL`, materials) and the lights in the studio section.
