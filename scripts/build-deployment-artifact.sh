#!/usr/bin/env bash
set -euo pipefail

readonly repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${repository_root}"

if [[ "${VIRTUAL_RELEASE_ALLOW_DIRTY:-0}" != "1" ]]; then
  if ! git diff --quiet || ! git diff --cached --quiet || \
    [[ -n "$(git ls-files --others --exclude-standard)" ]]; then
    echo "refusing to build a production artifact from a dirty worktree" >&2
    exit 1
  fi
fi

readonly release_commit="$(git rev-parse HEAD)"
readonly release_short="$(git rev-parse --short=12 HEAD)"
readonly output_dir="${1:-${repository_root}/output/releases}"
readonly artifact_path="${output_dir}/virtual-risk-radar-${release_short}.tar.gz"
artifact_tmp_dir="$(mktemp -d)"
trap 'rm -rf "${artifact_tmp_dir}"' EXIT
readonly artifact_stage="${artifact_tmp_dir}/stage"
mkdir -p "${artifact_stage}" "${output_dir}"

pnpm build:web

readonly tracked_paths=(
  package.json
  pnpm-lock.yaml
  pnpm-workspace.yaml
  tsconfig.json
  apps/server
  packages
  config
)
git archive --format=tar "${release_commit}" "${tracked_paths[@]}" | \
  tar -xf - -C "${artifact_stage}"
mkdir -p "${artifact_stage}/dist"
cp -R dist/web "${artifact_stage}/dist/web"
printf '%s\n' "${release_commit}" > "${artifact_stage}/RELEASE_COMMIT"
printf '%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "${artifact_stage}/RELEASE_CREATED_AT"

tar -czf "${artifact_path}" -C "${artifact_stage}" .
readonly artifact_sha="$(shasum -a 256 "${artifact_path}" | awk '{print $1}')"
chmod 0644 "${artifact_path}"

echo "ARTIFACT_READY path=${artifact_path} sha256=${artifact_sha} commit=${release_commit}"
