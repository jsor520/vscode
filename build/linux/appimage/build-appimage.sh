#!/usr/bin/env bash
set -euo pipefail

# Build AppImage from raw VS Code build output
# Usage: ./build-appimage.sh <build-dir> <output-dir>

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../../.." && pwd)"

BUILD_DIR="${1:?Usage: $0 <build-dir> <output-dir>}"
OUT_DIR="${2:?Usage: $0 <build-dir> <output-dir>}"

# Read config from product.json
PRODUCT_JSON="$ROOT_DIR/product.json"
APP_NAME=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$PRODUCT_JSON','utf8')).applicationName)")
NAME_SHORT=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$PRODUCT_JSON','utf8')).nameShort)")
XUANJI_VERSION=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$PRODUCT_JSON','utf8')).xuanjiVersion)")
ICON_NAME=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$PRODUCT_JSON','utf8')).linuxIconName)")

APPDIR="$OUT_DIR/${NAME_SHORT}.AppDir"

echo "=== Building AppImage ==="
echo "  App name: $APP_NAME"
echo "  Version: $XUANJI_VERSION"
echo "  Build dir: $BUILD_DIR"
echo "  Output dir: $OUT_DIR"

# Clean old AppDir
rm -rf "$APPDIR"
mkdir -p "$APPDIR/usr"

# Copy raw build output into AppDir
cp -r "$BUILD_DIR"/* "$APPDIR/usr/"

# Create AppRun entry point
cat > "$APPDIR/AppRun" << 'APPRUN_EOF'
#!/usr/bin/env bash
SELF="$(readlink -f "$0")"
HERE="${SELF%/*}"
export PATH="${HERE}/usr:${PATH}"
export LD_LIBRARY_PATH="${HERE}/usr:${LD_LIBRARY_PATH:-}"
exec "${HERE}/usr/bin/${XUANJI_APP_NAME}" "$@"
APPRUN_EOF

# Replace app name placeholder in AppRun
sed -i "s|\${XUANJI_APP_NAME}|${APP_NAME}|g" "$APPDIR/AppRun"
chmod +x "$APPDIR/AppRun"

# Create .desktop file
cat > "$APPDIR/${APP_NAME}.desktop" << DESKTOP_EOF
[Desktop Entry]
Name=${NAME_SHORT}
Comment=AI-Powered Code Editor
Exec=AppRun %F
Icon=${ICON_NAME}
Type=Application
Categories=Development;IDE;TextEditor;
MimeType=text/plain;inode/directory;
StartupWMClass=${APP_NAME}
DESKTOP_EOF

# Copy icon
ICON_SRC="$ROOT_DIR/resources/linux/code.png"
if [ -f "$ICON_SRC" ]; then
    cp "$ICON_SRC" "$APPDIR/${ICON_NAME}.png"
else
    echo "Warning: icon file not found: $ICON_SRC"
    # Try to find icon from build artifacts
    FOUND_ICON=$(find "$BUILD_DIR" -name "*.png" -path "*/icons/*" | head -1 || true)
    if [ -n "$FOUND_ICON" ]; then
        cp "$FOUND_ICON" "$APPDIR/${ICON_NAME}.png"
    fi
fi

# Download appimagetool
APPIMAGETOOL="$OUT_DIR/appimagetool"
if [ ! -f "$APPIMAGETOOL" ]; then
    echo "Downloading appimagetool..."
    ARCH=$(uname -m)
    curl -fsSL "https://github.com/AppImage/appimagetool/releases/download/continuous/appimagetool-${ARCH}.AppImage" -o "$APPIMAGETOOL"
    chmod +x "$APPIMAGETOOL"
fi

# Build AppImage
OUTPUT_FILE="$OUT_DIR/XuanJi-${XUANJI_VERSION}.AppImage"
echo "Building AppImage: $OUTPUT_FILE"

ARCH=$(uname -m) "$APPIMAGETOOL" --no-appstream "$APPDIR" "$OUTPUT_FILE"

if [ -f "$OUTPUT_FILE" ]; then
    SIZE=$(du -h "$OUTPUT_FILE" | cut -f1)
    echo "AppImage built successfully: $OUTPUT_FILE ($SIZE)"
else
    echo "Error: AppImage build failed"
    exit 1
fi
