# Mineshaft

Multiplayer browser voxel sandbox: one shared infinite world, biomes, caves and ores, 45 block types, third-person humanoid characters, PvP, day/night, ambient occlusion lighting.

The whole client is ONE file: public/index.html (own WebGL renderer, no libraries, no external assets).

## Run locally
    npm install
    npm start        # http://localhost:3000

## Deploy on Render
Push to GitHub, then Render > New > Blueprint (uses render.yaml), or New > Web Service with build `npm install` and start `npm start`.
Free tier sleeps when idle and has no disk, so the world resets on restart. Paid plan: add a disk and set DATA_DIR (see render.yaml).

## Reliability
- Client auto-reconnects with backoff, pings every 15s, and keeps playing offline (single-player) if the server is asleep or unreachable. It switches to the shared world when the server answers.
- Server ignores malformed/abusive messages, rate-limits, and drops dead sockets with heartbeats.

## Performance
Quality auto-adjusts (render distance, resolution, lighting, leaf detail) from the measured frame rate and device. Button "Quality" cycles auto/low/med/high.

## Controls
PC: WASD, Space jump/swim, Shift sprint, F fly, V first/third person, E block palette, 1-9 or wheel slot, left click break/hit (hold to repeat), right click place.
Mobile: left thumb joystick (push fully to sprint), drag right side to look, buttons for jump / hit-break / place / view / blocks. Auto-jump over single blocks.
