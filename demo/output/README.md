# Demo Output Reference

Commands used to generate each file:

## PNG – Room centered (default room 3287, Verden area)

```bash
# Default settings, room centered
tsx demo/headless.ts --format png --room 3287 --output demo/output/default.png

# Close-up view
tsx demo/headless.ts --format png --room 3287 --padding 1 --output demo/output/room_closeup.png

# More padding
tsx demo/headless.ts --format png --room 3287 --padding 5 --output demo/output/room_padded.png

# Circle rooms
tsx demo/headless.ts --format png --room 3287 --room-shape circle --output demo/output/circles.png

# Rounded rectangles
tsx demo/headless.ts --format png --room 3287 --room-shape roundedRectangle --output demo/output/rounded.png

# Rounded rectangles + emboss
tsx demo/headless.ts --format png --room 3287 --room-shape roundedRectangle --emboss --output demo/output/rounded_emboss.png

# Frame mode
tsx demo/headless.ts --format png --room 3287 --frame-mode --output demo/output/frame_mode.png

# Grid
tsx demo/headless.ts --format png --room 3287 --grid --output demo/output/grid.png

# Grid + custom background
tsx demo/headless.ts --format png --room 3287 --grid --bg-color "#1a1a2e" --output demo/output/grid_custom_bg.png
```

## PNG – Full area

```bash
# Hi-res full area (Pozostale wyspy Skellige)
tsx demo/headless.ts --format png --area 57 --width 3840 --height 2160 --label-mode data --output demo/output/area_hires.png
```

## SVG

```bash
# Full area
tsx demo/headless.ts --format svg --area 57 --output demo/output/area_full.svg

# Grid
tsx demo/headless.ts --format svg --area 57 --grid --output demo/output/grid.svg

# Frame mode + circle + grid
tsx demo/headless.ts --format svg --area 57 --frame-mode --room-shape circle --grid --output demo/output/frame_circle_grid.svg

# Room centered
tsx demo/headless.ts --format svg --room 3287 --output demo/output/room_centered.svg

# Pathfinding
tsx demo/headless.ts --format svg --path 3287,3300 --output demo/output/pathfinding.svg
```
