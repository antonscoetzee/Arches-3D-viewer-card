# 3DHOP Model Viewer Card for Arches
# Anton Coetzee, 2026

An Arches 8.1 card component that embeds a full [3DHOP](https://3dhop.net) viewer
into any card whose nodegroup contains a file-list node. Supports **NXS**, **NXZ**
(Nexus compressed). This has only been tested on Arches 8.1.1. I will test it on the newer
versions shortly.

---

## Features

- Automatic model loading from the card's file-list node
- Viewport-filling canvas that resizes with the window
- Overlay toolbar: reset view, zoom in/out, light trackball, measure, fullscreen
- Distance measurement with on-canvas result popup
- All 3DHOP runtime scripts are vendored (no CDN dependency)

---

## Repository layout

```
arches-3dhop-card-extension-framework/
│
├── extensions/cards/threedhop-model-viewer-card/
│   ├── threedhop-model-viewer-card.js        # Knockout viewmodel
│   ├── threedhop-model-viewer-card.htm       # Knockout template
│   ├── threedhop-model-viewer-card.json      # Arches card registration metadata
│   └── vendor/                               # ← NOT copied by load_package (see below)
│       └── 3dhop/
│           ├── spidergl.js
│           ├── presenter.js
│           ├── nexus.js
│           ├── ply.js
│           ├── jquery.js
│           ├── trackball_turntable.js
│           ├── trackball_turntable_pan.js
│           ├── trackball_pantilt.js
│           └── trackball_sphere.js
│
├── media/js/views/components/cards/threedhop-model-viewer-card/vendor/3dhop/
│   └── (same vendor scripts — source for deployment)
│
├── install.sh                                # Full install script (see below)
├── config/urls_range_patch.py               # Drop-in urls.py patch (see below)
└── package_config.json
```

---
## The Arches docs are unclear on this, so I had to hedge my bets on installation:##
## What Arches `load_package` can install

`python manage.py packages -o load_package` handles:

| File | Destination |
|------|-------------|
| `extensions/cards/threedhop-model-viewer-card.js` | `<APP_ROOT>/media/js/views/components/cards/` |
| `extensions/cards/threedhop-model-viewer-card.htm` | `<APP_ROOT>/templates/views/components/cards/` |
| `extensions/cards/threedhop-model-viewer-card.json` | `<APP_ROOT>/cards/` |

It also calls `card_component register --source <json>` automatically.

**`load_package` cannot:**

1. Copy subdirectories — `vendor/` is silently skipped because `load_extensions`
   only iterates root-level files.
2. Re-register the card if the destination `.json` already exists (it skips the
   copy and the register call).
3. Apply the HTTP Range patch to your project's `urls.py`.

All three gaps are covered by `install.sh`.

---

## Required change to Arches project `urls.py`: Only for testing
## The web server handles this on a deployed instance.

NXS/NXZ files are streamed by `nexus.js` using HTTP `Range` requests
(byte-range partial content). Django's built-in `FileResponse` returns `200 OK`
for range requests instead of `206 Partial Content`, which nexus.js silently
ignores and the model never loads.

This adds a `ranged_media_serve` view that handles `Range` headers before
Django's stock media-serving kicks in.

The patched `urls.py` is at `config/urls_range_patch.py`. It is a **complete
replacement** for `<project_name>/urls.py`. If you have
project-specific URL patterns already, merge them into the `urlpatterns` list at
the top.

Key addition (relative to a stock Arches 8.1 project `urls.py`):

```python
# Range-aware media file serving — add BEFORE the static() line
urlpatterns.append(
    path(
        settings.MEDIA_URL.lstrip("/") + "<path:path>",
        ranged_media_serve,
    )
)
```

The `ranged_media_serve` function is defined at the top of the patched file.

---

## Installation

### Prerequisites

- Arches 8.1 project running in Docker (or adjust paths for bare-metal)
- Node.js available inside the container (for `npm run build_development`)
- This repository cloned to the host

### Automated install: `install.sh`

`install.sh` handles everything in one command:

```bash
cd /path/to/this/repo
./install.sh --container arches \
             --manage-dir /arches_app/arches_slocal \
             --app-root /arches_app/arches_slocal/arches_slocal
```

What it does, in order:

1. **Removes stale files** — deletes any previously installed `.js`, `.htm`,
   `.json` so `load_package` doesn't skip them.
2. **Removes stale DB entry** — deletes the `CardComponent` row so
   `card_component register` doesn't refuse to overwrite.
3. **Copies `.js`, `.htm`, `.json`** directly into the correct container paths.
4. **Registers the card** — runs `card_component register`.
5. **Copies vendor scripts** — copies the `vendor/3dhop/` directory into
   `<APP_ROOT>/media/js/views/components/cards/threedhop-model-viewer-card/vendor/3dhop/`.
6. **Patches `urls.py`** — copies `config/urls_range_patch.py` to
   `<APP_ROOT>/../urls.py` (i.e. the project-level `urls.py`). **Review this
   step** if you have custom URL patterns — you may prefer to merge manually.
7. **Rebuilds the frontend** — runs `npm run build_development` inside the
   container.

### Manual install (step by step)

#### 1. Copy extension files into the container

```bash
CONTAINER=arches
APP_ROOT=/arches_app/arches_slocal/arches_slocal
COMPONENT=threedhop-model-viewer-card
SRC=extensions/cards/$COMPONENT

docker exec "$CONTAINER" mkdir -p \
    "$APP_ROOT/cards" \
    "$APP_ROOT/media/js/views/components/cards" \
    "$APP_ROOT/templates/views/components/cards"

docker cp "$SRC/$COMPONENT.js"   "$CONTAINER:$APP_ROOT/media/js/views/components/cards/$COMPONENT.js"
docker cp "$SRC/$COMPONENT.htm"  "$CONTAINER:$APP_ROOT/templates/views/components/cards/$COMPONENT.htm"
docker cp "$SRC/$COMPONENT.json" "$CONTAINER:$APP_ROOT/cards/$COMPONENT.json"
```

#### 2. Register the card component

```bash
docker exec "$CONTAINER" python /arches_app/arches_slocal/manage.py \
    card_component register \
    --source "$APP_ROOT/cards/$COMPONENT.json"

# Verify:
docker exec "$CONTAINER" python /arches_app/arches_slocal/manage.py \
    card_component list | grep -i threedhop
```

#### 3. Copy vendor scripts

```bash
VENDOR_DEST="$APP_ROOT/media/js/views/components/cards/$COMPONENT/vendor/3dhop"
VENDOR_SRC="media/js/views/components/cards/$COMPONENT/vendor/3dhop"

docker exec "$CONTAINER" mkdir -p "$VENDOR_DEST"

for f in "$VENDOR_SRC"/*.js; do
    docker cp "$f" "$CONTAINER:$VENDOR_DEST/$(basename "$f")"
done
```

#### 4. Patch `urls.py`

Copy `config/urls_range_patch.py` to your project's `urls.py`:

```bash
docker cp config/urls_range_patch.py \
    "$CONTAINER:/arches_app/arches_slocal/arches_slocal/urls.py"
```

Or manually add `ranged_media_serve` (see above) to your existing `urls.py`.

#### 5. Rebuild the frontend

```bash
docker exec -w /arches_app/arches_slocal "$CONTAINER" npm run build_development
```

Hard-refresh the browser after the build completes.

---

## Graph Designer setup

1. Open your resource model in Graph Designer.
2. Create (or select) a nodegroup containing a **file-list** node.
3. On the **Card** for that nodegroup, set **Card Component** to
   **3DHOP Model Viewer Card**.
4. Save the card.
5. Upload an NXS, NXZ, or PLY file through the standard file-list widget.
6. Open the record, the model renders automatically.

---

## Upgrading

Re-run `install.sh`. The script deletes old files and the DB registration entry
before re-installing, so no manual cleanup is needed.

If you are updating only the `.js` or `.htm` (no vendor script changes):

```bash
docker cp extensions/cards/threedhop-model-viewer-card/threedhop-model-viewer-card.js \
    arches:/arches_app/arches_slocal/arches_slocal/media/js/views/components/cards/threedhop-model-viewer-card.js
docker cp extensions/cards/threedhop-model-viewer-card/threedhop-model-viewer-card.htm \
    arches:/arches_app/arches_slocal/arches_slocal/templates/views/components/cards/threedhop-model-viewer-card.htm
docker exec -w /arches_app/arches_slocal arches npm run build_development
```

---

## Toolbar reference

| Button | Action |
|--------|--------|
| ⌂ | Reset trackball to initial position |
| + | Zoom in |
| − | Zoom out |
| ☀ | Toggle light trackball (drag to relight the model; yellow = active) |
| ↔ | Measure distance between two points (click two points; result shown bottom-left; green = active) |
| ⛶ / ✕ | Enter / exit fullscreen |

---

## Measurement units

Distances shown by the measure tool are in **normalised scene units**. The 3DHOP
presenter normalises every model so its bounding sphere has radius ≈ 1. A
measurement of `0.25` means one-quarter of the model's bounding radius. To get
real-world distances, multiply by the known bounding-sphere radius of your model.
I normally map these to metres when creating the model (Metashape w/ coded targets)

---

## Supported file formats

| Format | Extension | Notes |
|--------|-----------|-------|
| Nexus | `.nxs` | Streamable multiresolution mesh |
| Nexus compressed | `.nxz` | As above, smaller file |

---

## Known limitations / production notes

- **HTTP Range support is required.** The `urls.py` patch above adds Range
  support for Django's development server and Gunicorn. If you serve media files
  via nginx or another proxy, ensure the proxy forwards `Range` headers and
  respects `206` responses. Most nginx configurations do this correctly by default.
- **`load_package` skips vendor scripts.** This is an Arches limitation — the
  package loader only copies root-level files from each extension directory.
  The vendor scripts must be copied separately (handled by `install.sh`).
- **Re-registration.** `load_package` will not re-register the card if the
  destination `.json` already exists. Use `install.sh` or the manual steps above
  for upgrades.

