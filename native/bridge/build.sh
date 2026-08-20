#!/bin/sh

set -eu

requested_arch="${1:-universal}"
configuration="${2:-release}"
if [ "${requested_arch}" = "host" ]; then
  requested_arch="$(uname -m)"
fi
if [ "${requested_arch}" = "x86_64" ]; then requested_arch="x64"; fi
case "${requested_arch}" in
  arm64|x64|universal) ;;
  *)
    echo "Unsupported native bridge architecture: ${requested_arch}" >&2
    exit 1
    ;;
esac
case "${configuration}" in
  debug|release) ;;
  *)
    echo "Unsupported native bridge configuration: ${configuration}" >&2
    exit 1
    ;;
esac

node_include="$(node -p 'require("node:path").resolve(require("node:path").dirname(process.execPath), "../include/node")')"
if [ ! -f "${node_include}/node_api.h" ]; then
  echo "Node-API headers were not found at ${node_include}" >&2
  exit 1
fi

mkdir -p .swift-cache/clang .swift-cache/swift
export CLANG_MODULE_CACHE_PATH="${CLANG_MODULE_CACHE_PATH:-$PWD/.swift-cache/clang}"
export SWIFTPM_MODULECACHE_OVERRIDE="${SWIFTPM_MODULECACHE_OVERRIDE:-$PWD/.swift-cache/swift}"

build_root=".todesktop/native/.openhistory-native-build"
swift_scratch_root=".todesktop/native/.swiftpm/${configuration}"
output_root=".todesktop/native/${requested_arch}"
module_output="${output_root}/openhistory-native.node"
library_output="${output_root}/libOpenHistoryCollector.dylib"
optimization="-Onone"
if [ "${configuration}" = "release" ]; then optimization="-O"; fi

rm -rf "${build_root}"
mkdir -p "${build_root}" "${output_root}"

build_architecture() {
  swift_arch="$1"
  output_name="$2"
  architecture_root="${build_root}/${output_name}"
  swift_scratch_path="${swift_scratch_root}/${output_name}"
  mkdir -p "${architecture_root}" "${swift_scratch_path}"
  swift build \
    --disable-sandbox \
    --package-path native/collector \
    --scratch-path "${swift_scratch_path}" \
    --configuration "${configuration}" \
    --arch "${swift_arch}" >&2
  bin_path="$(swift build \
    --disable-sandbox \
    --package-path native/collector \
    --scratch-path "${swift_scratch_path}" \
    --configuration "${configuration}" \
    --arch "${swift_arch}" \
    --show-bin-path)"

  xcrun swiftc \
    -target "${swift_arch}-apple-macos14.0" \
    -parse-as-library \
    -emit-library \
    "${optimization}" \
    -D OPENHISTORY_EMBEDDED_COLLECTOR \
    -module-name OpenHistoryCollectorBridge \
    -I "${bin_path}/Modules" \
    native/collector/Sources/ActivityCollector/AccessibilityEventMonitor.swift \
    native/collector/Sources/ActivityCollector/AccessibilityReader.swift \
    native/collector/Sources/ActivityCollector/PointerEventTap.swift \
    native/collector/Sources/ActivityCollector/CollectorRuntime.swift \
    native/bridge/EmbeddedCollectorBridge.swift \
    "${bin_path}/ActivityCore.build/ActivityEvent.swift.o" \
    "${bin_path}/ActivityCore.build/BrowserProtectionState.swift.o" \
    "${bin_path}/ActivityCore.build/EventWriter.swift.o" \
    "${bin_path}/ActivityCore.build/SemanticObservation.swift.o" \
    "${bin_path}/ActivityCore.build/SemanticProtectionPolicy.swift.o" \
    -Xlinker -install_name \
    -Xlinker @rpath/libOpenHistoryCollector.dylib \
    -o "${architecture_root}/libOpenHistoryCollector.dylib"

  xcrun clang \
    -arch "${swift_arch}" \
    -mmacosx-version-min=14.0 \
    -std=c11 \
    -fvisibility=hidden \
    -bundle \
    -Wl,-undefined,dynamic_lookup \
    -Wl,-rpath,@loader_path \
    -I "${node_include}" \
    -L "${architecture_root}" \
    -lOpenHistoryCollector \
    -framework ApplicationServices \
    -framework CoreFoundation \
    native/bridge/openhistory_native.c \
    -o "${architecture_root}/openhistory-native.node"
}

if [ "${requested_arch}" = "universal" ]; then
  build_architecture arm64 arm64
  build_architecture x86_64 x64
  lipo -create \
    "${build_root}/arm64/openhistory-native.node" \
    "${build_root}/x64/openhistory-native.node" \
    -output "${module_output}"
  lipo -create \
    "${build_root}/arm64/libOpenHistoryCollector.dylib" \
    "${build_root}/x64/libOpenHistoryCollector.dylib" \
    -output "${library_output}"
else
  swift_arch="${requested_arch}"
  if [ "${requested_arch}" = "x64" ]; then swift_arch="x86_64"; fi
  build_architecture "${swift_arch}" "${requested_arch}"
  cp "${build_root}/${requested_arch}/openhistory-native.node" "${module_output}"
  cp "${build_root}/${requested_arch}/libOpenHistoryCollector.dylib" "${library_output}"
fi

chmod 755 "${module_output}" "${library_output}"
codesign --force --sign - --timestamp=none "${library_output}"
codesign --force --sign - --timestamp=none "${module_output}"
rm -rf "${build_root}"
echo "${module_output}"
echo "${library_output}"
