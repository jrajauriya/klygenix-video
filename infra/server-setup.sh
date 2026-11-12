#!/bin/bash
# Usage (once, as root on a fresh Ubuntu 24.04 VPS): bash server-setup.sh [--hostname NAME] [--cloudflare-only]
set -euo pipefail

HOSTNAME_NEW=""
CF_ONLY=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --hostname) HOSTNAME_NEW="$2"; shift 2 ;;
    --cloudflare-only) CF_ONLY=1; shift ;;
    -h|--help) sed -n 2p "$0"; exit 0 ;;
    *) echo "unknown option: $1"; exit 2 ;;
  esac
done

[[ $EUID -eq 0 ]] || { echo "run as root"; exit 1; }
. /etc/os-release
[[ "$ID" == "ubuntu" ]] || { echo "Ubuntu only (found $ID)"; exit 1; }
export DEBIAN_FRONTEND=noninteractive

step() { echo; echo "==> $*"; }

step "System packages"
apt-get update -q
apt-get upgrade -yq
apt-get install -yq ca-certificates curl gnupg ufw fail2ban unattended-upgrades rclone jq
dpkg-reconfigure -f noninteractive unattended-upgrades
systemctl enable --now fail2ban

step "Clock: UTC, NTP on"
timedatectl set-timezone UTC
timedatectl set-ntp true
if [[ -n "$HOSTNAME_NEW" ]]; then hostnamectl set-hostname "$HOSTNAME_NEW"; fi

step "Swap (4 GB)"
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 4G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi
sysctl -w vm.swappiness=10 >/dev/null
echo 'vm.swappiness=10' > /etc/sysctl.d/90-swappiness.conf

step "Docker Engine + compose plugin"
if ! command -v docker >/dev/null; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $VERSION_CODENAME stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -q
  apt-get install -yq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
mkdir -p /etc/docker
if [[ ! -f /etc/docker/daemon.json ]]; then
  echo '{"log-driver":"json-file","log-opts":{"max-size":"20m","max-file":"5"}}' > /etc/docker/daemon.json
  systemctl restart docker
fi
systemctl enable --now docker
docker compose version

step "Firewall: 22, 80, 443"
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

if [[ "$CF_ONLY" == "1" ]]; then
  step "80/443 from Cloudflare only (DOCKER-USER: published ports bypass ufw's INPUT rules)"
  IFACE=$(ip route show default | awk '{print $5; exit}')
  v4=$(curl -fsS https://www.cloudflare.com/ips-v4)
  v6=$(curl -fsS https://www.cloudflare.com/ips-v6)
  [[ -n "$v4" && -n "$v6" ]] || { echo "could not fetch Cloudflare ranges"; exit 1; }
  write_rules() {
    local file="$1" ranges="$2"
    sed -i '/^# BEGIN klygenix-cf-only/,/^# END klygenix-cf-only/d' "$file"
    {
      echo "# BEGIN klygenix-cf-only"
      echo "*filter"
      echo ":DOCKER-USER - [0:0]"
      for r in $ranges; do
        echo "-A DOCKER-USER -i $IFACE -p tcp -m conntrack --ctorigdstport 80 --ctdir ORIGINAL -s $r -j RETURN"
        echo "-A DOCKER-USER -i $IFACE -p tcp -m conntrack --ctorigdstport 443 --ctdir ORIGINAL -s $r -j RETURN"
      done
      echo "-A DOCKER-USER -i $IFACE -p tcp -m conntrack --ctorigdstport 80 --ctdir ORIGINAL -j DROP"
      echo "-A DOCKER-USER -i $IFACE -p tcp -m conntrack --ctorigdstport 443 --ctdir ORIGINAL -j DROP"
      echo "-A DOCKER-USER -j RETURN"
      echo "COMMIT"
      echo "# END klygenix-cf-only"
    } >> "$file"
  }
  write_rules /etc/ufw/after.rules "$v4"
  write_rules /etc/ufw/after6.rules "$v6"
  ufw reload
fi

step "SSH: keys only"
if [[ ! -s /root/.ssh/authorized_keys ]]; then
  echo "!! /root/.ssh/authorized_keys is empty — leaving password login on so you are not locked out"
else
  cat > /etc/ssh/sshd_config.d/00-klygenix.conf <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
EOF
  sshd -t
  sshd -T | grep -E '^(passwordauthentication|kbdinteractiveauthentication|permitrootlogin) '
  systemctl reload ssh
fi

step "Folders (/opt/<app> per stack)"
mkdir -p /opt/klygenix-video/{apps/web,apps/studio,apps/admin,apps/tv,backend,infra/nginx/ssl}
mkdir -p /opt/klygenix-video/backups/{wal,base}
chown 999:999 /opt/klygenix-video/backups/wal /opt/klygenix-video/backups/base
chmod 700 /opt/klygenix-video/infra/nginx/ssl
mkdir -p /var/lib/node_exporter/textfile_collector

step "Done"
echo "$(hostname) · $(lsb_release -ds) · docker $(docker --version | awk '{print $3}' | tr -d ,)"
free -h | awk 'NR<=3'
ufw status | sed -n '1,12p'
