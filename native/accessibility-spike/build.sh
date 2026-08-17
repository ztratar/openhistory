#!/bin/sh

set -eu

requested_arch="${1:-universal}"
case "${requested_arch}" in
  arm64|x64|universal) ;;
  *)
    echo "Unsupported Accessibility spike architecture: ${requested_arch}" >&2
    exit 1
    ;;
esac

node_include="$(node -p 'require("node:path").resolve(require("node:path").dirname(process.execPath), "../include/node")')"
if [ ! -f "${node_include}/node_api.h" ]; then
  echo "Node-API headers were not found at ${node_include}" >&2
  exit 1
fi

source_file="native/accessibility-spike/accessibility_identity_probe.c"
build_root=".todesktop/native/.accessibility-spike-build"
output_root=".todesktop/native/${requested_arch}"
output_file="${output_root}/accessibility-identity-probe.node"

rm -rf "${build_root}"
mkdir -p "${build_root}" "${output_root}"

compile_architecture() {
  architecture="$1"
  destination="$2"
  xcrun clang \
    -arch "${architecture}" \
    -mmacosx-version-min=14.0 \
    -std=c11 \
    -fvisibility=hidden \
    -bundle \
    -Wl,-undefined,dynamic_lookup \
    -I "${node_include}" \
    -framework ApplicationServices \
    -framework CoreFoundation \
    "${source_file}" \
    -o "${destination}"
}

if [ "${requested_arch}" = "universal" ]; then
  arm64_file="${build_root}/accessibility-identity-probe-arm64.node"
  x64_file="${build_root}/accessibility-identity-probe-x64.node"
  compile_architecture arm64 "${arm64_file}"
  compile_architecture x86_64 "${x64_file}"
  lipo -create "${arm64_file}" "${x64_file}" -output "${output_file}"
else
  clang_arch="${requested_arch}"
  if [ "${requested_arch}" = "x64" ]; then clang_arch="x86_64"; fi
  compile_architecture "${clang_arch}" "${output_file}"
fi

chmod 755 "${output_file}"
codesign --force --sign - --timestamp=none "${output_file}"
rm -rf "${build_root}"
echo "${output_file}"
