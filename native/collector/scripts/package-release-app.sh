#!/bin/sh
set -eu

requested_arch="${1:-host}"
sign_mode="${2:-none}"
app_version="${OPENHISTORY_APP_VERSION:-0.1.0}"

if [ "${requested_arch}" = "host" ]; then
  requested_arch="$(uname -m)"
fi
if [ "${requested_arch}" = "x86_64" ]; then
  requested_arch="x64"
fi

case "${requested_arch}" in
  arm64|x64|universal) ;;
  *)
    echo "Unsupported native release architecture: ${requested_arch}" >&2
    exit 1
    ;;
esac

output_root=".todesktop/native/${requested_arch}"
app_directory="${output_root}/OpenHistory Collector.app"
macos_directory="${app_directory}/Contents/MacOS"

build_architecture() {
  swift_arch="$1"
  swift build \
    --disable-sandbox \
    --package-path native/collector \
    --configuration release \
    --arch "${swift_arch}" >&2
  swift build \
    --disable-sandbox \
    --package-path native/collector \
    --configuration release \
    --arch "${swift_arch}" \
    --show-bin-path
}

mkdir -p .swift-cache/clang .swift-cache/swift
export CLANG_MODULE_CACHE_PATH="${CLANG_MODULE_CACHE_PATH:-$PWD/.swift-cache/clang}"
export SWIFTPM_MODULECACHE_OVERRIDE="${SWIFTPM_MODULECACHE_OVERRIDE:-$PWD/.swift-cache/swift}"

rm -rf "${app_directory}"
mkdir -p "${macos_directory}"
cp native/collector/App/Info.plist "${app_directory}/Contents/Info.plist"

if [ "${requested_arch}" = "universal" ]; then
  arm64_bin="$(build_architecture arm64)"
  x64_bin="$(build_architecture x86_64)"
  lipo -create \
    "${arm64_bin}/activity-collector" \
    "${x64_bin}/activity-collector" \
    -output "${macos_directory}/activity-collector"
  lipo -create \
    "${arm64_bin}/foundation-model-worker" \
    "${x64_bin}/foundation-model-worker" \
    -output "${macos_directory}/foundation-model-worker"
else
  swift_arch="${requested_arch}"
  if [ "${requested_arch}" = "x64" ]; then
    swift_arch="x86_64"
  fi
  bin_path="$(build_architecture "${swift_arch}")"
  cp "${bin_path}/activity-collector" "${macos_directory}/activity-collector"
  cp "${bin_path}/foundation-model-worker" "${macos_directory}/foundation-model-worker"
fi

chmod 755 \
  "${macos_directory}/activity-collector" \
  "${macos_directory}/foundation-model-worker"
/usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString ${app_version}" "${app_directory}/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleVersion ${app_version}" "${app_directory}/Contents/Info.plist"

if [ "${sign_mode}" = "adhoc" ]; then
  codesign --force --deep --sign - "${app_directory}"
elif [ "${sign_mode}" != "none" ]; then
  echo "Unsupported native signing mode: ${sign_mode}" >&2
  exit 1
fi

echo "${app_directory}"
