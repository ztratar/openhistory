#!/bin/sh
set -eu

configuration="${1:-debug}"
build_directory="native/collector/.build/${configuration}"
source_executable="${build_directory}/activity-collector"
model_executable="${build_directory}/foundation-model-worker"
app_directory="${build_directory}/OpenHistory Collector.app"
macos_directory="${app_directory}/Contents/MacOS"

if [ ! -x "${source_executable}" ]; then
  echo "Native collector executable is missing: ${source_executable}" >&2
  exit 1
fi

mkdir -p "${macos_directory}"
cp "${source_executable}" "${macos_directory}/activity-collector"
if [ -x "${model_executable}" ]; then
  cp "${model_executable}" "${macos_directory}/foundation-model-worker"
fi
cp "native/collector/App/Info.plist" "${app_directory}/Contents/Info.plist"
codesign --force --deep --sign - "${app_directory}"
