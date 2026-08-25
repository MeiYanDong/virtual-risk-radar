#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "install-release.sh must run as root" >&2
  exit 1
fi

if [[ "$#" -ne 3 ]]; then
  echo "usage: install-release.sh <artifact.tar.gz> <sha256> <commit>" >&2
  exit 1
fi

readonly artifact_path="$1"
readonly expected_sha="$2"
readonly release_id="$3"
readonly app_root="/opt/virtual-risk-radar"
readonly releases_root="${app_root}/releases"
readonly release_dir="${releases_root}/${release_id}"
readonly data_root="/var/lib/virtual-risk-radar"
readonly current_link="${app_root}/current"

if [[ ! "${expected_sha}" =~ ^[0-9a-f]{64}$ ]]; then
  echo "invalid SHA-256" >&2
  exit 1
fi
if [[ ! "${release_id}" =~ ^[0-9a-f]{7,40}$ ]]; then
  echo "invalid release commit" >&2
  exit 1
fi
if [[ ! -f "${artifact_path}" ]]; then
  echo "artifact does not exist" >&2
  exit 1
fi

printf '%s  %s\n' "${expected_sha}" "${artifact_path}" | sha256sum --check --strict
if tar -tzf "${artifact_path}" | grep -Eq '(^/|(^|/)\.\.(/|$))'; then
  echo "artifact contains an unsafe path" >&2
  exit 1
fi

if [[ -e "${release_dir}" ]]; then
  echo "release already exists: ${release_id}" >&2
  exit 1
fi

stage_dir="$(mktemp -d "${releases_root}/.stage-${release_id}.XXXXXX")"
cleanup_stage() {
  if [[ -n "${stage_dir:-}" && -d "${stage_dir}" ]]; then
    rm -rf "${stage_dir}"
  fi
}
trap cleanup_stage EXIT

tar -xzf "${artifact_path}" -C "${stage_dir}"
for required_path in \
  RELEASE_COMMIT \
  package.json \
  pnpm-lock.yaml \
  apps/server/src/index.ts \
  config/default.json \
  dist/web/index.html; do
  if [[ ! -e "${stage_dir}/${required_path}" ]]; then
    echo "artifact is missing ${required_path}" >&2
    exit 1
  fi
done

if [[ "$(tr -d '\n' < "${stage_dir}/RELEASE_COMMIT")" != "${release_id}" ]]; then
  echo "artifact commit does not match requested release" >&2
  exit 1
fi

(
  cd "${stage_dir}"
  /usr/local/bin/pnpm install --prod --frozen-lockfile
)

ln -s "${data_root}" "${stage_dir}/data"
chown -R root:root "${stage_dir}"
chmod -R go-w "${stage_dir}"
mv "${stage_dir}" "${release_dir}"
stage_dir=""

previous_target=""
if [[ -L "${current_link}" ]]; then
  previous_target="$(readlink -f "${current_link}")"
fi

activate_release() {
  local target="$1"
  ln -sfn "${target}" "${app_root}/current.next"
  mv -Tf "${app_root}/current.next" "${current_link}"
}

rollback_release() {
  if [[ -n "${previous_target}" && -d "${previous_target}" ]]; then
    activate_release "${previous_target}"
    systemctl restart virtual-risk-radar.service || true
  else
    systemctl stop virtual-risk-radar.service || true
  fi
}

activate_release "${release_dir}"
systemctl daemon-reload
systemctl enable virtual-risk-radar.service
if ! systemctl restart virtual-risk-radar.service; then
  rollback_release
  echo "service restart failed; previous release restored" >&2
  exit 1
fi

health_file="$(mktemp)"
trap 'rm -f "${health_file}"' EXIT
health_ok=false
for _ in $(seq 1 30); do
  if curl --fail --silent --show-error --max-time 3 \
    http://127.0.0.1:8787/api/health --output "${health_file}"; then
    if grep -q '"externalInputCount":2' "${health_file}" && \
      grep -q '"writeCapabilities":"UNSUPPORTED"' "${health_file}"; then
      health_ok=true
      break
    fi
  fi
  sleep 1
done

if [[ "${health_ok}" != true ]]; then
  rollback_release
  echo "health readback failed; previous release restored" >&2
  exit 1
fi

if ! nginx -t; then
  rollback_release
  echo "nginx validation failed; previous release restored" >&2
  exit 1
fi
systemctl reload nginx.service

echo "RELEASE_INSTALLED commit=${release_id} service=active health=pass"
