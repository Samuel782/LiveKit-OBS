#!/usr/bin/env bash
# Build SlideOBS for Windows and macOS. Requires Go and npm (build time only).
set -euo pipefail
cd "$(dirname "$0")"

PDFJS_VERSION="${PDFJS_VERSION:-6.5.438}"
VENDOR="web/vendor/pdfjs"

if [ ! -f "$VENDOR/VERSION" ] || [ "$(cat "$VENDOR/VERSION")" != "$PDFJS_VERSION" ]; then
  echo "==> Scarico pdfjs-dist@$PDFJS_VERSION da npm"
  tmp="$(mktemp -d)"
  ( cd "$tmp" && npm pack "pdfjs-dist@$PDFJS_VERSION" --silent >/dev/null && tar xzf pdfjs-dist-*.tgz )
  rm -rf "$VENDOR"
  mkdir -p "$VENDOR"
  # The "legacy" build includes polyfills for older Chromium (OBS uses CEF).
  cp "$tmp/package/legacy/build/pdf.min.mjs" "$tmp/package/legacy/build/pdf.worker.min.mjs" "$VENDOR/"
  cp -R "$tmp/package/cmaps" "$tmp/package/standard_fonts" "$tmp/package/wasm" "$tmp/package/iccs" "$VENDOR/"
  cp "$tmp/package/LICENSE" "$VENDOR/LICENSE"
  echo "$PDFJS_VERSION" > "$VENDOR/VERSION"
  rm -rf "$tmp"
fi

echo "==> go vet"
go vet ./...

mkdir -p dist
LDFLAGS="-s -w"
build() {
  echo "==> $1/$2 -> $3"
  CGO_ENABLED=0 GOOS="$1" GOARCH="$2" go build -trimpath -ldflags "$LDFLAGS" -o "$3" .
}
build windows amd64 dist/SlideOBS.exe
build darwin  arm64 dist/SlideOBS-mac-arm64
build darwin  amd64 dist/SlideOBS-mac-intel
if [ "${WITH_LINUX:-0}" = "1" ]; then build linux amd64 dist/SlideOBS-linux-amd64; fi
chmod +x dist/SlideOBS-mac-arm64 dist/SlideOBS-mac-intel
perl -pe 's/\r?\n/\r\n/' LEGGIMI.txt > dist/LEGGIMI.txt
ls -lh dist
