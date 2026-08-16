#!/bin/sh

set -eu

application_path="${1:-}"
expected_app_id="${2:-io.github.ztratar.openhistory}"
expected_helper_id="${3:-io.github.ztratar.openhistory.collector}"
expected_team_id="${4:-PNTEN2B9C4}"

if [ -z "${application_path}" ] || [ ! -d "${application_path}" ]; then
  echo "Usage: $0 /path/to/OpenHistory.app [expected-app-id] [expected-helper-id] [expected-team-id]" >&2
  exit 64
fi

case "${application_path}" in
  *.app) ;;
  *)
    echo "Expected a macOS .app bundle: ${application_path}" >&2
    exit 64
    ;;
esac

helper_path="${application_path}/Contents/Resources/native/OpenHistory Collector.app"
if [ ! -d "${helper_path}" ]; then
  echo "Nested collector bundle is missing: ${helper_path}" >&2
  exit 1
fi

bundle_id() {
  /usr/libexec/PlistBuddy -c "Print :CFBundleIdentifier" "$1/Contents/Info.plist"
}

signature_details() {
  /usr/bin/codesign --display --verbose=4 "$1" 2>&1
}

team_id() {
  signature_details "$1" | /usr/bin/sed -n 's/^TeamIdentifier=//p' | /usr/bin/tail -n 1
}

verify_developer_id_signature() {
  bundle="$1"
  label="$2"
  details="$(signature_details "${bundle}")"

  /usr/bin/codesign --verify --deep --strict --verbose=4 "${bundle}"

  echo "${details}" | /usr/bin/grep -q '^Authority=Developer ID Application:' || {
    echo "${label} is not signed with a Developer ID Application certificate." >&2
    exit 1
  }
  echo "${details}" | /usr/bin/grep -q '^Timestamp=' || {
    echo "${label} signature does not contain a secure timestamp." >&2
    exit 1
  }
  echo "${details}" | /usr/bin/grep -Eq '^CodeDirectory .*flags=.*runtime' || {
    echo "${label} signature does not enable the hardened runtime." >&2
    exit 1
  }
}

main_bundle_id="$(bundle_id "${application_path}")"
helper_bundle_id="$(bundle_id "${helper_path}")"

if [ "${main_bundle_id}" != "${expected_app_id}" ]; then
  echo "Unexpected main bundle identifier: ${main_bundle_id}" >&2
  exit 1
fi
if [ "${helper_bundle_id}" != "${expected_helper_id}" ]; then
  echo "Unexpected collector bundle identifier: ${helper_bundle_id}" >&2
  exit 1
fi

verify_developer_id_signature "${application_path}" "OpenHistory"
verify_developer_id_signature "${helper_path}" "OpenHistory Collector"

main_team_id="$(team_id "${application_path}")"
helper_team_id="$(team_id "${helper_path}")"
if [ "${main_team_id}" != "${expected_team_id}" ] || [ "${helper_team_id}" != "${expected_team_id}" ]; then
  echo "Main and collector TeamIdentifiers must both be ${expected_team_id}." >&2
  exit 1
fi

/usr/bin/codesign --display --requirements - "${application_path}" 2>&1
/usr/bin/codesign --display --requirements - "${helper_path}" 2>&1
/usr/sbin/spctl --assess --type execute --verbose=4 "${application_path}"
/usr/bin/xcrun stapler validate "${application_path}"

version="$(/usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" "${application_path}/Contents/Info.plist")"
echo "Signed macOS release verification passed for OpenHistory ${version} (TeamIdentifier ${main_team_id})."
