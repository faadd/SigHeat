#!/data/data/com.termux/files/usr/bin/bash
# Keep this process alive in Termux; Ctrl+C stops measurement and releases wake lock.
set -euo pipefail
sigheat_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
sigheat_child=""
sigheat_wake=0
cleanup() {
  trap - EXIT INT TERM
  if [[ -n "$sigheat_child" ]] && kill -0 "$sigheat_child" 2>/dev/null; then
    kill -TERM "$sigheat_child" 2>/dev/null || true
    wait "$sigheat_child" 2>/dev/null || true
  fi
  if [[ "$sigheat_wake" == 1 ]]; then termux-wake-unlock || true; fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
if command -v termux-wake-lock >/dev/null 2>&1; then
  if termux-wake-lock; then sigheat_wake=1; fi
else
  echo 'Wake lock Termux tidak tersedia. Sistem dapat menghentikan proses saat layar mati.' >&2
fi
cd -- "$sigheat_root"
python -u termux_edge.py "$@" &
sigheat_child=$!
wait "$sigheat_child"
