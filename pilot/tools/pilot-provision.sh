#!/usr/bin/env bash
# pilot-provision.sh: put the pilot stack on a box and start it. Runs from the laptop.
#
#   pilot/tools/pilot-provision.sh <bishop|janus> [--check] [--restart]
#
# Comes after FHU's sc-provision on the box (system updates, cloudflared, toolchain,
# accounts with sc-add-dev, Wi-Fi with sc-add-wifi). This script owns the pilot layer:
# node 22 and pnpm under ~/.local/opt, the python packages for the role, the WeChat
# detector models (bishop), the Waveshare e-Paper library with the SPI1 pin patch and
# tpm2-tools (both boxes), the source trees
# shipped from this laptop checkout (committed files only; node_modules and every path
# the repo's .gitignore names stay on the box), pnpm install, the box scripts, the
# systemd user units, linger, start, health. Every step prints one line: ok, TODO, or
# what it did.
#
#   --check    report every step, change nothing on the box
#   --restart  restart a running stack after the sync (default: start it only when down)
#
# Secrets never travel: .env and ~/.pilot-* stay on the box. The script lists what is
# missing and stops before starting services. Hardware (SPI, TPM, camera, config.txt) is
# reported, not changed: config.txt is FHU's.
#
# Laptop half: ships files with rsync, then runs the on-box half over ssh as
#   bash /tmp/pilot-provision.sh --on-box <box> <check|sync> <yes|no>
# The laptop half runs on macOS bash 3.2; the on-box half on the box's bash 5.
# shellcheck disable=SC2086,SC2016
set -euo pipefail

EXCLUDES=(--exclude node_modules --exclude .git --exclude '.env*' --exclude '*.log')

# ------------------------------------------------------------------ on-box half
on_box() {
  local box=$1 mode=$2 restart=$3 fail=0
  export PATH=$HOME/.local/opt/node/bin:$HOME/.local/bin:$PATH
  export DEBIAN_FRONTEND=noninteractive
  local logs=$HOME/pilot-logs
  mkdir -p "$logs"
  ok()   { echo "  ok    $*"; }
  todo() { echo "  TODO  $*"; fail=1; }
  step() { echo "== $*"; }

  step "box"
  . /etc/os-release
  echo "  $(hostname), $PRETTY_NAME, $(uname -m), user $USER, mode $mode"
  case "$(hostname)" in
    *"$box"*) ;;
    *) echo "  hostname $(hostname) does not contain '$box': wrong ssh alias?"; return 1 ;;
  esac
  [ "$(uname -m)" = aarch64 ] || { echo "  not arm64, stop"; return 1; }
  if sudo -n true 2>/dev/null; then ok "passwordless sudo"
  else echo "  no passwordless sudo: sudo sc-add-dev $USER \"<key>\" --sudo first"; return 1; fi
  if curl -fsI -m 10 http://deb.debian.org/ >/dev/null; then ok "internet"
  else echo "  no internet: sudo sc-add-wifi first"; return 1; fi
  local g want_groups="spi gpio"
  [ "$box" = bishop ] && want_groups="video spi gpio"
  for g in $want_groups; do
    if id -nG | grep -qw "$g"; then ok "group $g"; else todo "group $g missing (sc-add-dev adds it; log out and in)"; fi
  done

  step "apt packages"
  local p pk="git rsync python3-pil python3-qrcode python3-numpy" missing=""
  pk="$pk python3-spidev python3-gpiozero python3-rpi-lgpio python3-lgpio tpm2-tools"  # e-paper and TPM, both boxes
  [ "$box" = bishop ] && pk="$pk python3-opencv python3-picamera2 rpicam-apps-lite"
  for p in $pk; do
    dpkg -s "$p" 2>/dev/null | grep -q "^Status: install ok installed" || missing="$missing $p"
  done
  if [ -z "$missing" ]; then ok "present: $pk"
  elif [ "$mode" = check ]; then todo "apt-get install:$missing"
  else
    # The log is the user's own file; root is only for apt.
    # shellcheck disable=SC2024
    sudo -n apt-get -qq update >"$logs/provision-apt.log" 2>&1
    # shellcheck disable=SC2024
    sudo -n apt-get install -y -qq $missing >>"$logs/provision-apt.log" 2>&1
    ok "installed:$missing"
  fi
  # tpm2-tools creates the tss group; a member runs tpm2_* on /dev/tpmrm0 without sudo.
  if id -nG | grep -qw tss; then ok "group tss"
  elif ! getent group tss >/dev/null; then todo "group tss absent until tpm2-tools is installed"
  elif [ "$mode" = check ]; then todo "group tss: usermod -aG tss $USER, then log out and in"
  else sudo -n usermod -aG tss "$USER"; ok "group tss added; log out and in for tpm2_* without sudo"; fi

  step "node 22 and pnpm under ~/.local/opt/node"
  local want_node=22 want_pnpm=11.28.4 have base tarball b
  have=$(~/.local/opt/node/bin/node -v 2>/dev/null || true)
  case "$have" in
    v$want_node.*) ok "node $have" ;;
    *)
      if [ "$mode" = check ]; then todo "install node $want_node (have ${have:-none})"
      else
        base=https://nodejs.org/dist/latest-v$want_node.x
        tarball=$(curl -fsSL "$base/" | grep -oE "node-v${want_node}[0-9.]*-linux-arm64\.tar\.xz" | head -n 1)
        [ -n "$tarball" ] || { echo "  no linux-arm64 tarball at $base"; return 1; }
        mkdir -p ~/.local/opt
        ( cd ~/.local/opt \
          && curl -fsSLO "$base/$tarball" \
          && curl -fsSL "$base/SHASUMS256.txt" | grep " $tarball\$" | sha256sum -c --quiet \
          && tar -xJf "$tarball" && rm -f "$tarball" \
          && ln -sfn "${tarball%.tar.xz}" node )
        ok "node $(~/.local/opt/node/bin/node -v) installed"
      fi ;;
  esac
  have=$(~/.local/opt/node/bin/pnpm -v 2>/dev/null || true)
  if [ "$have" = "$want_pnpm" ]; then ok "pnpm $have"
  elif [ "$mode" = check ]; then todo "install pnpm $want_pnpm (have ${have:-none})"
  else
    ~/.local/opt/node/bin/npm install -g --silent "pnpm@$want_pnpm"
    ok "pnpm $(~/.local/opt/node/bin/pnpm -v) installed"
  fi
  if [ "$mode" != check ]; then
    mkdir -p ~/.local/bin
    for b in node npm npx corepack pnpm pnpx; do
      [ -e ~/.local/opt/node/bin/$b ] && ln -sfn ~/.local/opt/node/bin/$b ~/.local/bin/$b
    done
  fi
  local line='export PATH=$HOME/.local/opt/node/bin:$HOME/.local/bin:$PATH'
  if grep -qF "$line" ~/.bashrc 2>/dev/null; then ok "PATH line in ~/.bashrc"
  elif [ "$mode" = check ]; then todo "add the PATH line to ~/.bashrc"
  else
    printf '\n# node and pnpm from ~/.local/opt (pilot-provision.sh)\n%s\n' "$line" >> ~/.bashrc
    ok "PATH line added to ~/.bashrc"
  fi

  if [ "$box" = bishop ]; then
    step "WeChat detector models in ~/wechat_qr"
    local f mbase=https://raw.githubusercontent.com/WeChatCV/opencv_3rdparty/wechat_qrcode
    local sums='cc49b8c9babaf45f3037610fe499df38c8819ebda29e90ca9f2e33270f6ef809  detect.caffemodel
e8acfc395caf443a47f15686a9b9207b36cb8f7e6ceb8fbaf6466665e68a9466  detect.prototxt
e5d36889d8e6ef2f1c1f515f807cec03979320ac81792cd8fb927c31fd658ae3  sr.caffemodel
8ae41acba97e8b4a8e741ee350481e49b8e01d787193f470a4c95ee1c02d5b61  sr.prototxt'
    if [ -d ~/wechat_qr ] && (cd ~/wechat_qr && echo "$sums" | sha256sum -c --status 2>/dev/null); then
      ok "four model files, checksums match"
    elif [ "$mode" = check ]; then todo "download the four model files from $mbase"
    else
      mkdir -p ~/wechat_qr
      ( cd ~/wechat_qr \
        && for f in detect.caffemodel detect.prototxt sr.caffemodel sr.prototxt; do curl -fsSLO "$mbase/$f"; done \
        && echo "$sums" | sha256sum -c --quiet )
      ok "models downloaded, checksums match"
    fi
  fi

  step "Waveshare e-Paper library in ~/e-Paper"
  if [ -f ~/e-Paper/RaspberryPi_JetsonNano/python/lib/waveshare_epd/epd4in2_V2.py ]; then ok "epd4in2_V2 present"
  elif [ "$mode" = check ]; then todo "sparse clone of waveshareteam/e-Paper, RaspberryPi_JetsonNano/python only"
  else
    rm -rf ~/e-Paper
    git clone -q --depth 1 --filter=blob:none --sparse https://github.com/waveshareteam/e-Paper.git ~/e-Paper
    git -C ~/e-Paper sparse-checkout set RaspberryPi_JetsonNano/python
    ok "e-Paper library cloned ($(du -sh ~/e-Paper | cut -f1))"
  fi
  # The TPM takes the vendor's DC and BUSY pins (GPIO 25, 24) and SPI0 CE1, so the panel sits
  # on SPI1 with CS GPIO16, DC GPIO22, BUSY GPIO27. The vendor file has the SPI0 pins;
  # ~/epdconfig-spi1.patch (pilot/tools, copied with the box files) moves it. A fresh clone
  # needs it again. Wiring and the reasoning: vault note tpm-letstrust.
  local epdp=$HOME/epdconfig-spi1.patch
  if [ ! -d ~/e-Paper/.git ]; then :
  elif [ ! -f "$epdp" ]; then todo "pin patch $epdp not on the box yet (sync copies it)"
  elif git -C ~/e-Paper apply --reverse --check "$epdp" 2>/dev/null; then ok "epdconfig.py on the SPI1 pins"
  elif [ "$mode" = check ]; then todo "epdconfig.py has the vendor SPI0 pins; sync applies $epdp"
  elif git -C ~/e-Paper apply "$epdp" 2>"$logs/provision-epd.log"; then ok "epdconfig.py patched to the SPI1 pins"
  else todo "pin patch does not apply, upstream changed epdconfig.py? see $logs/provision-epd.log"; fi

  step "sources"
  local d dirs=$HOME/StormCatch-Credential-Core
  [ "$box" = bishop ] && dirs="$dirs $HOME/StormCatch-Credential-Core/robot-agent"
  [ "$box" = janus ] && dirs="$dirs $HOME/stormcatch-policy-sdk"
  if [ -f ~/.pilot-version ]; then ok "shipped: $(tr '\n' ';' < ~/.pilot-version)"
  else todo "$HOME/.pilot-version absent: no sync from this script yet"; fi

  step "pnpm install --frozen-lockfile"
  for d in $dirs; do
    if [ ! -f "$d/pnpm-lock.yaml" ]; then todo "$d: no pnpm-lock.yaml, tree not shipped"; continue; fi
    if [ "$mode" = check ]; then
      if [ -d "$d/node_modules" ]; then ok "$d: node_modules present (a sync re-runs the install)"
      else todo "$d: install"; fi
    elif ( cd "$d" && pnpm install --frozen-lockfile >"$logs/provision-install.log" 2>&1 ); then ok "$d"
    else
      echo "  FAILED in $d, tail of $logs/provision-install.log:"
      tail -n 8 "$logs/provision-install.log"
      return 1
    fi
  done

  step "secrets on the box (never copied)"
  local k envf=$HOME/StormCatch-Credential-Core/.env miss=""
  local keys="PARADYM_API_KEY PARADYM_FACILITY_WALLET_ID PARADYM_GATE_WALLET_ID PARADYM_TASKAUTH_TEMPLATE_ID PARADYM_TASKAUTH_TYPE PARADYM_DID_ID PARADYM_TRUSTED_ENTITY_ID PARADYM_GATE1_TEMPLATE_ID PARADYM_GATE2_TEMPLATE_ID PARADYM_PRESENTATION_TEMPLATE_ID PARADYM_PAYLOAD_TEMPLATE_ID"
  if [ "$box" = janus ]; then
    if [ -f "$envf" ]; then
      for k in $keys; do grep -qE "^$k=." "$envf" || miss="$miss $k"; done
      if [ -z "$miss" ]; then ok ".env carries the 11 PARADYM_* keys"; else todo ".env lacks:$miss"; fi
      [ "$mode" = check ] || chmod 600 "$envf"
    else todo "$envf missing; keys: $keys"; fi
    if [ -s ~/.pilot-birth-anchors ]; then ok ".pilot-birth-anchors"
    else todo "$HOME/.pilot-birth-anchors absent: the decision service reads no birth certificate (one DID or sha256:<hex> per line)"; fi
    for f in ~/.pilot-engine-token ~/.pilot-webhook-token; do
      if [ -s "$f" ]; then ok "$(basename "$f")"; else echo "  info  $(basename "$f") absent, janus-start.sh writes one at first start"; fi
    done
    [ "$mode" = check ] || chmod 600 ~/.pilot-* 2>/dev/null || true
  else
    if [ -f "$envf" ]; then ok ".env present (robot-service does not read it)"; else echo "  info  no .env, the robot box needs none"; fi
  fi

  step "hardware"
  local other=sc-dev-cm5-janus cfg=/boot/firmware/config.txt
  [ "$box" = janus ] && other=sc-dev-pi5-bishop
  # Both boxes carry the LetsTrust TPM on SPI0 CE1 and the e-paper on SPI1. The three lines
  # live in config.txt, which is FHU's, so they are reported, not written.
  if grep -qE '^dtparam=spi=on' "$cfg" && [ -e /dev/spidev0.0 ]; then ok "SPI on, /dev/spidev0.0"
  else todo "SPI off: 'dtparam=spi=on' in $cfg (FHU's file), then reboot"; fi
  if grep -qE '^dtoverlay=tpm-slb9670' "$cfg" && [ -c /dev/tpm0 ]; then ok "TPM: /dev/tpm0"
  else todo "TPM: 'dtoverlay=tpm-slb9670' under [all] in $cfg (FHU's file), then reboot"; fi
  if grep -qE '^dtoverlay=spi1-1cs,cs0_pin=16' "$cfg" && [ -c /dev/spidev1.0 ]; then ok "e-paper bus: /dev/spidev1.0, CS GPIO16"
  else todo "e-paper bus: 'dtoverlay=spi1-1cs,cs0_pin=16' under [all] in $cfg (FHU's file), then reboot"; fi
  if [ "$box" = bishop ]; then
    if rpicam-hello --list-cameras 2>/dev/null | grep -qE '^[0-9]+ :'; then
      ok "camera: $(rpicam-hello --list-cameras 2>/dev/null | grep -E '^[0-9]+ :' | head -n 1 | cut -c1-40)"
    else todo "no camera detected (ribbon seated? camera_auto_detect=1 in config.txt?)"; fi
  fi
  if getent hosts "$other.local" >/dev/null; then ok "mDNS: $other.local is $(getent hosts "$other.local" | awk '{print $1}')"
  else todo "mDNS: $other.local does not resolve (other box off, or on another network)"; fi

  step "systemd user units"
  local u units=pilot.service
  [ "$box" = janus ] && units="pilot.service pilot-tunnel.service"
  for u in $units; do
    if [ -f ~/.config/systemd/user/$u ]; then ok "$u in place"; else todo "$u missing from ~/.config/systemd/user (a sync copies it)"; fi
  done
  if [ "$(loginctl show-user "$USER" -p Linger --value 2>/dev/null)" = yes ]; then ok "linger on"
  elif [ "$mode" = check ]; then todo "enable linger"
  else sudo -n loginctl enable-linger "$USER"; ok "linger enabled"; fi
  if [ "$mode" != check ]; then
    chmod +x ~/"$box"-*.sh 2>/dev/null || true
    systemctl --user daemon-reload
    for u in $units; do systemctl --user enable -q "$u"; done
  fi

  step "stack"
  if [ "$mode" = check ]; then
    for u in $units; do echo "  $u: $(systemctl --user is-active "$u" 2>/dev/null || true)"; done
    return $fail
  fi
  if [ $fail -ne 0 ]; then echo "  not started: settle the TODO lines above, then run again"; return 1; fi
  if systemctl --user is-active -q pilot.service; then
    if [ "$restart" = yes ]; then systemctl --user restart pilot.service; echo "  pilot.service restarted"
    else echo "  pilot.service already running (--restart to restart it with the synced files)"; fi
  else systemctl --user start pilot.service; echo "  pilot.service started"; fi
  if [ "$box" = janus ] && ! systemctl --user is-active -q pilot-tunnel.service; then
    systemctl --user start --no-block pilot-tunnel.service; echo "  pilot-tunnel.service starting"
  fi
  sleep 3
  "$HOME/$box-start.sh" status 2>/dev/null | head -n 8 | sed 's/^/  /'
}

# ------------------------------------------------------------------ laptop half
if [ "${1:-}" = --on-box ]; then on_box "$2" "$3" "$4"; exit $?; fi

BOX=${1:?usage: pilot-provision.sh <bishop|janus> [--check] [--restart]}
shift
case "$BOX" in bishop|janus) ;; *) echo "box must be bishop or janus" >&2; exit 2 ;; esac
MODE=sync; RESTART=no
for a in "$@"; do
  case "$a" in
    --check) MODE=check ;;
    --restart) RESTART=yes ;;
    *) echo "unknown option $a" >&2; exit 2 ;;
  esac
done

HERE=$(cd "$(dirname "$0")/../.." && pwd)
SDK=${SDK_DIR:-$(dirname "$HERE")/stormcatch-policy-sdk}
git -C "$HERE" rev-parse --is-inside-work-tree >/dev/null 2>&1 || { echo "$HERE is not a git checkout" >&2; exit 1; }
if [ "$BOX" = janus ] && [ ! -d "$SDK/.git" ]; then
  echo "policy-sdk checkout not at $SDK (SDK_DIR=... to point elsewhere)" >&2; exit 1
fi
ssh -o BatchMode=yes -o ConnectTimeout=10 "$BOX" true 2>/dev/null || { echo "ssh $BOX: no answer" >&2; exit 1; }

# One source tree, committed files only, into one directory under the box home.
# Stale tracked files go (--delete); whatever the repo's .gitignore names is state or
# cache on the box (lists/, .stormcatch/, captures/, dist/, .env, logs) and is left alone.
ship() {
  local src=$1 dest=$2 rev tmp diff dels chg pat
  local ex=("${EXCLUDES[@]}")
  if [ -f "$src/.gitignore" ]; then
    while IFS= read -r pat; do ex+=(--exclude "$pat"); done < <(
      sed -e 's/#.*//' -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e '/^$/d' -e '/^!/d' -e 's#/$##' "$src/.gitignore")
  fi
  rev=$(git -C "$src" rev-parse --short HEAD)
  [ -z "$(git -C "$src" status --porcelain)" ] || echo "note: $src has uncommitted changes; HEAD $rev is what ships"
  tmp=$(mktemp -d)
  git -C "$src" archive HEAD | tar -x -C "$tmp"
  # Content comparison (-c): a git archive carries commit times, not the box's.
  if [ "$MODE" = check ]; then
    diff=$(rsync -rlcn --delete "${ex[@]}" --itemize-changes "$tmp/" "$BOX:$dest/" | grep -E '^(\*deleting|[<>]f)' || true)
    if [ -z "$diff" ]; then echo "$dest: matches $rev"
    else
      dels=$(echo "$diff" | grep '^\*deleting' || true)
      chg=$(echo "$diff" | grep -v '^\*deleting' || true)
      echo "$dest: differs from $rev ($(echo "$chg" | grep -c . ) files to copy, $(echo "$dels" | grep -c .) to delete):"
      if [ -n "$dels" ]; then echo "$dels" | sed 's/^/  /'; fi
      if [ -n "$chg" ]; then echo "$chg" | head -n 10 | sed 's/^/  /'; fi
    fi
  else
    rsync -rlc --delete "${ex[@]}" "$tmp/" "$BOX:$dest/"
    echo "$dest: $rev"
  fi
  rm -rf "$tmp"
}

ship "$HERE" StormCatch-Credential-Core
if [ "$BOX" = janus ]; then ship "$SDK" stormcatch-policy-sdk; fi

# Box scripts, the sweep tool, the e-paper pin patch, this script, the user units.
FILES=("$HERE/pilot/$BOX"/*.sh "$HERE/pilot/$BOX"/*.py "$HERE/pilot/tools/qr_sweep.py" "$HERE/pilot/tools/epdconfig-spi1.patch" "$0")
UNITS=("$HERE/pilot/$BOX"/*.service)
if [ "$MODE" = check ]; then
  diff=$(rsync -rlcn --itemize-changes "${FILES[@]}" "$BOX:" | grep -E '^[<>]f' || true)
  if ssh "$BOX" 'test -d .config/systemd/user'; then
    udiff=$(rsync -rlcn --itemize-changes "${UNITS[@]}" "$BOX:.config/systemd/user/" | grep -E '^[<>]f' || true)
  else udiff="$HOME/.config/systemd/user missing on $BOX"; fi
  diff=$(printf '%s\n%s' "$diff" "$udiff" | sed '/^$/d')
  if [ -z "$diff" ]; then echo "box files: match"; else echo "box files: differ:"; echo "$diff" | sed 's/^/  /'; fi
else
  ssh "$BOX" 'mkdir -p .config/systemd/user'
  rsync -rlc "${FILES[@]}" "$BOX:"
  rsync -rlc "${UNITS[@]}" "$BOX:.config/systemd/user/"
  {
    echo "StormCatch-Credential-Core $(git -C "$HERE" rev-parse --short HEAD) $(git -C "$HERE" branch --show-current) $(date -u +%FT%TZ)"
    if [ "$BOX" = janus ]; then
      echo "stormcatch-policy-sdk $(git -C "$SDK" rev-parse --short HEAD) $(git -C "$SDK" branch --show-current) $(date -u +%FT%TZ)"
    fi
  } | ssh "$BOX" 'cat > .pilot-version'
  echo "box files: copied"
fi

scp -q "$0" "$BOX:/tmp/pilot-provision.sh"
ssh "$BOX" "bash /tmp/pilot-provision.sh --on-box $BOX $MODE $RESTART"
