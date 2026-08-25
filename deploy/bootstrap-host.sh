#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "bootstrap-host.sh must run as root" >&2
  exit 1
fi

readonly deploy_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly node_version="22.22.3"
readonly pnpm_version="11.19.0"
readonly app_root="/opt/virtual-risk-radar"
readonly data_root="/var/lib/virtual-risk-radar"

if ! id -u vrr-admin >/dev/null 2>&1; then
  echo "vrr-admin must exist before host bootstrap" >&2
  exit 1
fi

if ! sudo -u vrr-admin test -r /home/vrr-admin/.ssh/authorized_keys; then
  echo "vrr-admin authorized_keys is missing" >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl nginx unattended-upgrades xz-utils

case "$(uname -m)" in
  x86_64) node_arch="x64" ;;
  aarch64) node_arch="arm64" ;;
  *)
    echo "unsupported architecture: $(uname -m)" >&2
    exit 1
    ;;
esac

readonly node_archive="node-v${node_version}-linux-${node_arch}.tar.xz"
readonly node_install_dir="/usr/local/lib/node-v${node_version}-linux-${node_arch}"

if [[ ! -x "${node_install_dir}/bin/node" ]]; then
  node_tmp_dir="$(mktemp -d)"
  trap 'rm -rf "${node_tmp_dir}"' EXIT
  curl --fail --silent --show-error --location \
    "https://nodejs.org/dist/v${node_version}/${node_archive}" \
    --output "${node_tmp_dir}/${node_archive}"
  curl --fail --silent --show-error --location \
    "https://nodejs.org/dist/v${node_version}/SHASUMS256.txt" \
    --output "${node_tmp_dir}/SHASUMS256.txt"
  (
    cd "${node_tmp_dir}"
    grep " ${node_archive}$" SHASUMS256.txt | sha256sum --check --strict
  )
  tar -xJf "${node_tmp_dir}/${node_archive}" -C /usr/local/lib
fi

for executable in node npm npx; do
  ln -sfn "${node_install_dir}/bin/${executable}" "/usr/local/bin/${executable}"
done
/usr/local/bin/npm install --global --no-audit --no-fund "pnpm@${pnpm_version}"
for executable in pnpm pnpx; do
  if [[ -e "${node_install_dir}/bin/${executable}" ]]; then
    ln -sfn "${node_install_dir}/bin/${executable}" "/usr/local/bin/${executable}"
  fi
done

if ! id -u virtual-risk >/dev/null 2>&1; then
  useradd --system --home-dir "${data_root}" --shell /usr/sbin/nologin virtual-risk
fi

install -d -o root -g root -m 0755 "${app_root}" "${app_root}/releases"
install -d -o virtual-risk -g virtual-risk -m 0700 "${data_root}" "${data_root}/runtime"

install -o root -g root -m 0755 \
  "${deploy_dir}/install-release.sh" \
  /usr/local/sbin/install-virtual-risk-radar-release
install -o root -g root -m 0644 \
  "${deploy_dir}/systemd/virtual-risk-radar.service" \
  /etc/systemd/system/virtual-risk-radar.service
install -o root -g root -m 0644 \
  "${deploy_dir}/nginx/virtual-risk-radar.conf" \
  /etc/nginx/sites-available/virtual-risk-radar.conf
ln -sfn /etc/nginx/sites-available/virtual-risk-radar.conf \
  /etc/nginx/sites-enabled/virtual-risk-radar.conf
if [[ -L /etc/nginx/sites-enabled/default ]]; then
  unlink /etc/nginx/sites-enabled/default
fi

install -o root -g root -m 0644 \
  "${deploy_dir}/ssh/99-virtual-risk-radar.conf" \
  /etc/ssh/sshd_config.d/99-virtual-risk-radar.conf

/usr/sbin/sshd -t
nginx -t
systemctl daemon-reload
systemctl enable virtual-risk-radar.service
systemctl enable --now nginx.service
systemctl enable --now unattended-upgrades.service
systemctl reload ssh.service

node_readback="$(/usr/local/bin/node --version)"
pnpm_readback="$(/usr/local/bin/pnpm --version)"
if [[ "${node_readback}" != "v${node_version}" || "${pnpm_readback}" != "${pnpm_version}" ]]; then
  echo "runtime version readback failed" >&2
  exit 1
fi

echo "HOST_BOOTSTRAP_OK node=${node_readback} pnpm=${pnpm_readback}"
