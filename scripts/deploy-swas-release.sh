#!/usr/bin/env bash
set -euo pipefail

if [[ "$#" -lt 2 || "$#" -gt 4 ]]; then
  echo "usage: deploy-swas-release.sh <artifact.tar.gz> <sha256> [host] [identity]" >&2
  exit 1
fi

readonly artifact_path="$1"
readonly expected_sha="$2"
readonly target_host="${3:-47.251.165.112}"
readonly identity_file="${4:-${HOME}/.config/virtual-risk-radar/ssh/id_ed25519}"
readonly target_user="vrr-admin"
readonly known_hosts_file="${HOME}/.config/virtual-risk-radar/ssh/known_hosts"

if [[ ! -f "${artifact_path}" || ! -f "${identity_file}" ]]; then
  echo "artifact or SSH identity is missing" >&2
  exit 1
fi
if [[ ! "${expected_sha}" =~ ^[0-9a-f]{64}$ ]]; then
  echo "invalid SHA-256" >&2
  exit 1
fi
if [[ ! "${target_host}" =~ ^[0-9a-zA-Z.-]+$ ]]; then
  echo "invalid target host" >&2
  exit 1
fi

actual_sha="$(shasum -a 256 "${artifact_path}" | awk '{print $1}')"
if [[ "${actual_sha}" != "${expected_sha}" ]]; then
  echo "local artifact checksum mismatch" >&2
  exit 1
fi

release_id="$(tar -xOf "${artifact_path}" ./RELEASE_COMMIT | tr -d '\n')"
if [[ ! "${release_id}" =~ ^[0-9a-f]{40}$ ]]; then
  echo "artifact release commit is invalid" >&2
  exit 1
fi

readonly remote_artifact="/tmp/virtual-risk-radar-${release_id}.tar.gz"
readonly ssh_options=(
  -i "${identity_file}"
  -o BatchMode=yes
  -o IdentitiesOnly=yes
  -o StrictHostKeyChecking=yes
  -o "UserKnownHostsFile=${known_hosts_file}"
  -o ConnectTimeout=10
)

scp "${ssh_options[@]}" "${artifact_path}" \
  "${target_user}@${target_host}:${remote_artifact}"
ssh "${ssh_options[@]}" "${target_user}@${target_host}" \
  sudo /usr/local/sbin/install-virtual-risk-radar-release \
  "${remote_artifact}" "${expected_sha}" "${release_id}"
ssh "${ssh_options[@]}" "${target_user}@${target_host}" \
  rm -f "${remote_artifact}"

echo "SWAS_DEPLOY_OK host=${target_host} commit=${release_id}"
