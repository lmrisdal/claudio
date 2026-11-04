#!/usr/bin/env bash
# Windows 11 test VM for the desktop sidecar, run with dockur/windows under podman.
# See the "Windows test VM" section in AGENTS.md.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VM_DIR="$ROOT_DIR/scripts/windows-vm"
STATE_DIR="${CLAUDIO_WINVM_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/claudio-winvm}"
STORAGE_DIR="$STATE_DIR/storage"
SNAPSHOT_DIR="$STATE_DIR/snapshots"
SHARED_DIR="$STATE_DIR/shared"
OEM_DIR="$STATE_DIR/oem"
KEY="$STATE_DIR/id_ed25519"
KNOWN_HOSTS="$STATE_DIR/known_hosts"
PASSWORD_FILE="$STATE_DIR/password"

CONTAINER="${CLAUDIO_WINVM_NAME:-claudio-winvm}"
IMAGE="docker.io/dockurr/windows:6.06"
VM_USER="claudio"
SSH_PORT="${CLAUDIO_WINVM_SSH_PORT:-2222}"
WEB_PORT="${CLAUDIO_WINVM_WEB_PORT:-8006}"
RDP_PORT="${CLAUDIO_WINVM_RDP_PORT:-3389}"
REMOTE_ROOT='C:\claudio'
REMOTE_TOOLS='C:\claudio-vm'

usage() {
  cat <<EOF
Usage: scripts/windows-vm.sh <command> [args]

  up                 create or start the VM (first start downloads and installs Windows)
  down               shut the VM down
  status             container state and whether SSH answers
  logs               follow the container log (install progress)
  wait [seconds]     wait until SSH answers (default 3600)
  provision          install the .NET 10 SDK, MSVC build tools, Node.js, Vite+ and Rust, and turn UAC on
  reboot             restart Windows and wait for SSH
  push [--clean]     copy the working tree (tracked and untracked, not ignored) to $REMOTE_ROOT
  ssh [command]      PowerShell over SSH, as an administrator with a full token
  run <command>      like ssh, but inside $REMOTE_ROOT
  desktop <command>  run in the signed-in desktop session with a normal (UAC-filtered) token
  pull <remote> <local>  copy a file from the VM
  snapshot <name>    stop the VM and save its disk (instant on btrfs)
  restore <name>     stop the VM and roll its disk back to a snapshot
  snapshots          list snapshots
  info               web viewer, RDP and credentials

State lives in $STATE_DIR.
EOF
}

ssh_opts=(-i "$KEY" -o IdentitiesOnly=yes -p "$SSH_PORT" -o UserKnownHostsFile="$KNOWN_HOSTS" -o StrictHostKeyChecking=accept-new
  -o ConnectTimeout=5 -o ServerAliveInterval=30 -o LogLevel=ERROR)

container_state() {
  podman container inspect --format '{{.State.Status}}' "$CONTAINER" 2>/dev/null || echo missing
}

ensure_state() {
  mkdir -p "$STORAGE_DIR" "$SNAPSHOT_DIR" "$SHARED_DIR" "$OEM_DIR"
  chmod 700 "$STATE_DIR"
  if [[ ! -f "$KEY" ]]; then
    ssh-keygen -q -t ed25519 -N '' -C claudio-winvm -f "$KEY"
  fi
  if [[ ! -f "$PASSWORD_FILE" ]]; then
    (umask 077 && head -c 18 /dev/urandom | base64 | tr -d '/+=' >"$PASSWORD_FILE")
  fi
  cp "$VM_DIR/oem/install.bat" "$VM_DIR/oem/enable-ssh.ps1" "$OEM_DIR/"
  cp "$KEY.pub" "$OEM_DIR/authorized_keys"
}

cmd_up() {
  ensure_state
  case "$(container_state)" in
    running) echo "$CONTAINER is already running" ;;
    missing)
      podman run -d --name "$CONTAINER" \
        --device /dev/kvm --device /dev/net/tun --cap-add NET_ADMIN \
        -p "127.0.0.1:$WEB_PORT:8006" \
        -p "127.0.0.1:$RDP_PORT:3389/tcp" -p "127.0.0.1:$RDP_PORT:3389/udp" \
        -p "127.0.0.1:$SSH_PORT:22" \
        -e VERSION=11 -e RAM_SIZE=8G -e CPU_CORES=6 -e DISK_SIZE=96G \
        -e USERNAME="$VM_USER" -e PASSWORD="$(cat "$PASSWORD_FILE")" \
        -e USER_PORTS=22 \
        -v "$STORAGE_DIR:/storage" -v "$SHARED_DIR:/shared" -v "$OEM_DIR:/oem:ro" \
        --stop-timeout 120 "$IMAGE" >/dev/null
      echo "started $CONTAINER; the first start installs Windows (about 20-40 minutes)"
      ;;
    *) podman start "$CONTAINER" >/dev/null && echo "started $CONTAINER" ;;
  esac
  echo "web viewer: http://127.0.0.1:$WEB_PORT"
}

cmd_down() {
  if [[ "$(container_state)" == running ]]; then
    podman stop -t 120 "$CONTAINER" >/dev/null
  fi
  echo "$CONTAINER is $(container_state)"
}

ssh_ready() {
  ssh "${ssh_opts[@]}" -o BatchMode=yes "$VM_USER@127.0.0.1" 'exit 0' >/dev/null 2>&1
}

cmd_status() {
  echo "container: $(container_state)"
  if ssh_ready; then echo "ssh: ready"; else echo "ssh: not reachable"; fi
}

cmd_wait() {
  local deadline=$((SECONDS + ${1:-3600}))
  until ssh_ready; do
    if ((SECONDS > deadline)); then
      echo "ssh did not come up in time" >&2
      return 1
    fi
    sleep 10
  done
  echo "ssh ready"
}

remote() {
  ssh "${ssh_opts[@]}" "$VM_USER@127.0.0.1" "$@"
}

copy_to() {
  scp -q -i "$KEY" -o IdentitiesOnly=yes -P "$SSH_PORT" -o UserKnownHostsFile="$KNOWN_HOSTS" -o StrictHostKeyChecking=accept-new \
    -o LogLevel=ERROR "$1" "$VM_USER@127.0.0.1:$2"
}

push_tools() {
  remote "New-Item -ItemType Directory -Force '$REMOTE_TOOLS','$REMOTE_ROOT' | Out-Null"
  copy_to "$VM_DIR/provision.ps1" "C:/claudio-vm/provision.ps1"
  copy_to "$VM_DIR/desktop-run.ps1" "C:/claudio-vm/desktop-run.ps1"
}

cmd_provision() {
  push_tools
  remote "powershell -NoProfile -ExecutionPolicy Bypass -File $REMOTE_TOOLS\\provision.ps1; exit \$LASTEXITCODE"
  if remote "if (Test-Path $REMOTE_TOOLS\\reboot-required) { Remove-Item $REMOTE_TOOLS\\reboot-required; exit 0 } else { exit 1 }"; then
    cmd_reboot
  fi
}

cmd_reboot() {
  echo "rebooting Windows"
  remote "Restart-Computer -Force" || true
  sleep 30
  cmd_wait 900
}

cmd_push() {
  push_tools
  if [[ "${1:-}" == --clean ]]; then
    remote "Get-ChildItem '$REMOTE_ROOT' -Force | Remove-Item -Recurse -Force"
  fi
  local archive
  archive="$(mktemp --suffix=.tar)"
  trap 'rm -f "$archive"' RETURN
  (cd "$ROOT_DIR" && git ls-files -z --cached --others --exclude-standard |
    while IFS= read -r -d '' file; do [[ -e "$file" ]] && printf '%s\0' "$file"; done |
    tar --null -T - -cf "$archive")
  copy_to "$archive" "C:/claudio-vm/push.tar"
  remote "tar.exe -xf $REMOTE_TOOLS\\push.tar -C $REMOTE_ROOT; if (\$LASTEXITCODE -ne 0) { exit \$LASTEXITCODE }; Remove-Item $REMOTE_TOOLS\\push.tar"
  echo "pushed $(tar -tf "$archive" | wc -l) files to $REMOTE_ROOT"
}

refresh_path='$env:Path = [Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [Environment]::GetEnvironmentVariable("Path","User");'

cmd_run() {
  remote "$refresh_path Set-Location $REMOTE_ROOT; $*; exit \$LASTEXITCODE"
}

cmd_desktop() {
  local command="$*"
  command="${command//\'/\'\'}"
  remote "& $REMOTE_TOOLS\\desktop-run.ps1 -Command '$command'; exit \$LASTEXITCODE"
}

snapshot_files() {
  find "$STORAGE_DIR" -maxdepth 1 -type f ! -name '*.iso'
}

cmd_snapshot() {
  local name="${1:?snapshot name required}"
  [[ "$name" =~ ^[A-Za-z0-9._-]+$ ]] || { echo "invalid snapshot name" >&2; return 1; }
  cmd_down
  mkdir -p "$SNAPSHOT_DIR/$name"
  snapshot_files | while read -r file; do
    cp --reflink=auto --sparse=always "$file" "$SNAPSHOT_DIR/$name/"
  done
  echo "saved snapshot $name"
}

cmd_restore() {
  local name="${1:?snapshot name required}"
  [[ -d "$SNAPSHOT_DIR/$name" ]] || { echo "no snapshot $name" >&2; return 1; }
  cmd_down
  for file in "$SNAPSHOT_DIR/$name"/*; do
    cp --reflink=auto --sparse=always "$file" "$STORAGE_DIR/"
  done
  echo "restored snapshot $name; run 'up' to start it"
}

cmd_info() {
  echo "web viewer: http://127.0.0.1:$WEB_PORT"
  echo "rdp:        127.0.0.1:$RDP_PORT  user $VM_USER, password in $PASSWORD_FILE"
  echo "ssh:        scripts/windows-vm.sh ssh   (key $KEY, port $SSH_PORT)"
  echo "shared:     $SHARED_DIR  (Z: in Windows)"
}

command="${1:-}"
shift || true
case "$command" in
  up) cmd_up ;;
  down) cmd_down ;;
  status) cmd_status ;;
  logs) podman logs -f "$CONTAINER" ;;
  wait) cmd_wait "$@" ;;
  provision) cmd_provision ;;
  reboot) cmd_reboot ;;
  push) cmd_push "$@" ;;
  ssh) remote "$@" ;;
  run) cmd_run "$@" ;;
  desktop) cmd_desktop "$@" ;;
  pull) scp -q -i "$KEY" -o IdentitiesOnly=yes -P "$SSH_PORT" -o UserKnownHostsFile="$KNOWN_HOSTS" -o LogLevel=ERROR \
    "$VM_USER@127.0.0.1:${1:?remote path}" "${2:?local path}" ;;
  snapshot) cmd_snapshot "$@" ;;
  restore) cmd_restore "$@" ;;
  snapshots) ls -1 "$SNAPSHOT_DIR" 2>/dev/null ;;
  info) cmd_info ;;
  *) usage ;;
esac
