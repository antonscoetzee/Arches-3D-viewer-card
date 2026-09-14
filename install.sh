#!/usr/bin/env bash
# install.sh
# Full install of the 3DHOP Model Viewer Card into a running Arches Docker container.
#
# Usage:
#   ./install.sh --container arches \
#                --manage-dir /arches_app/arches_slocal \
#                --app-root /arches_app/arches_slocal/arches_slocal
#
# Defaults (matching the reference deployment):
#   --container   arches
#   --manage-dir  /arches_app/arches_slocal
#   --app-root    /arches_app/arches_slocal/arches_slocal

set -euo pipefail

# ── Defaults ──────────────────────────────────────────────────────────────────
CONTAINER="arches"
MANAGE_DIR="/arches_app/arches_slocal"
APP_ROOT="/arches_app/arches_slocal/arches_slocal"

# ── Argument parsing ──────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
    case "$1" in
        --container)   CONTAINER="$2";   shift 2 ;;
        --manage-dir)  MANAGE_DIR="$2";  shift 2 ;;
        --app-root)    APP_ROOT="$2";    shift 2 ;;
        *) echo "Unknown option: $1" >&2; exit 1 ;;
    esac
done

COMPONENT="threedhop-model-viewer-card"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXT_DIR="$SCRIPT_DIR/extensions/cards/$COMPONENT"
VENDOR_SRC="$SCRIPT_DIR/media/js/views/components/cards/$COMPONENT/vendor/3dhop"
URLS_PATCH="$SCRIPT_DIR/config/urls_range_patch.py"

# ── Pre-flight checks ─────────────────────────────────────────────────────────
if ! docker inspect "$CONTAINER" &>/dev/null; then
    echo "ERROR: Docker container '$CONTAINER' not found or not running." >&2
    exit 1
fi

for f in "$EXT_DIR/$COMPONENT.js" "$EXT_DIR/$COMPONENT.htm" "$EXT_DIR/$COMPONENT.json"; do
    if [[ ! -f "$f" ]]; then
        echo "ERROR: Missing source file: $f" >&2
        exit 1
    fi
done

if [[ ! -d "$VENDOR_SRC" ]]; then
    echo "ERROR: Vendor scripts not found at $VENDOR_SRC" >&2
    exit 1
fi

if [[ ! -f "$URLS_PATCH" ]]; then
    echo "ERROR: urls.py patch not found at $URLS_PATCH" >&2
    exit 1
fi

CARDS_JS="$APP_ROOT/media/js/views/components/cards"
CARDS_TPL="$APP_ROOT/templates/views/components/cards"
CARDS_JSON="$APP_ROOT/cards"
URLS_DEST="$APP_ROOT/../$(basename "$APP_ROOT")/urls.py"
# Simpler: the project urls.py lives one level up from APP_ROOT, in the Django
# project package directory which shares the same name as APP_ROOT's basename.
PROJECT_PKG="$(basename "$APP_ROOT")"
URLS_DEST_CONTAINER="$APP_ROOT/../$PROJECT_PKG/urls.py"
# Actually the project package IS APP_ROOT itself for standard Arches layouts.
URLS_DEST_CONTAINER="$APP_ROOT/urls.py"

echo ""
echo "=== 3DHOP Model Viewer Card — Install ==="
echo "  Container : $CONTAINER"
echo "  manage.py : $MANAGE_DIR/manage.py"
echo "  APP_ROOT  : $APP_ROOT"
echo ""

# ── Step 1: Remove stale extension files ─────────────────────────────────────
echo "[1/6] Removing stale extension files..."
docker exec "$CONTAINER" rm -f \
    "$CARDS_JSON/$COMPONENT.json" \
    "$CARDS_JS/$COMPONENT.js" \
    "$CARDS_TPL/$COMPONENT.htm"

# ── Step 2: Remove stale CardComponent DB entry ───────────────────────────────
echo "[2/6] Removing stale CardComponent DB entry (if any)..."
docker exec "$CONTAINER" python "$MANAGE_DIR/manage.py" shell -c "
from arches.app.models.models import CardComponent
qs = CardComponent.objects.filter(componentname='$COMPONENT')
count = qs.count()
qs.delete()
print(f'  Deleted {count} DB record(s)')
"

# ── Step 3: Copy extension files ──────────────────────────────────────────────
echo "[3/6] Copying extension files..."
docker exec "$CONTAINER" mkdir -p "$CARDS_JSON" "$CARDS_JS" "$CARDS_TPL"

docker cp "$EXT_DIR/$COMPONENT.js"   "$CONTAINER:$CARDS_JS/$COMPONENT.js"
docker cp "$EXT_DIR/$COMPONENT.htm"  "$CONTAINER:$CARDS_TPL/$COMPONENT.htm"
docker cp "$EXT_DIR/$COMPONENT.json" "$CONTAINER:$CARDS_JSON/$COMPONENT.json"
echo "  Copied .js, .htm, .json"

# ── Step 4: Register the card component ───────────────────────────────────────
echo "[4/6] Registering card component..."
docker exec "$CONTAINER" python "$MANAGE_DIR/manage.py" \
    card_component register \
    --source "$CARDS_JSON/$COMPONENT.json"

docker exec "$CONTAINER" python "$MANAGE_DIR/manage.py" card_component list \
    | grep -i "threedhop\|3dhop" \
    && echo "  Registration confirmed." \
    || echo "  WARNING: component not found in list after registration."

# ── Step 5: Copy vendor scripts ───────────────────────────────────────────────
echo "[5/6] Copying 3DHOP vendor scripts..."
VENDOR_DEST="$CARDS_JS/$COMPONENT/vendor/3dhop"
docker exec "$CONTAINER" mkdir -p "$VENDOR_DEST"

for f in "$VENDOR_SRC"/*.js; do
    docker cp "$f" "$CONTAINER:$VENDOR_DEST/$(basename "$f")"
    echo "  ✓  $(basename "$f")"
done

# ── Step 6: Patch urls.py ─────────────────────────────────────────────────────
echo "[6/7] Patching urls.py (HTTP Range support for NXS files)..."
docker cp "$URLS_PATCH" "$CONTAINER:$URLS_DEST_CONTAINER"
echo "  Copied config/urls_range_patch.py → $URLS_DEST_CONTAINER"
echo "  NOTE: If you have custom URL patterns in urls.py, review the"
echo "        patched file and merge them manually."

# ── Step 7: Rebuild frontend ──────────────────────────────────────────────────
echo "[7/7] Rebuilding frontend (npm run build_development)..."
docker exec -w "$MANAGE_DIR" "$CONTAINER" npm run build_development 2>&1 \
    | grep -E "compiled|error|warning|ERROR|WARN" || true

echo ""
echo "Done. Hard-refresh your browser (Ctrl+Shift+R / Cmd+Shift+R)."
echo ""
