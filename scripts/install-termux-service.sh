#!/data/data/com.termux/files/usr/bin/bash
# Install an initially stopped runit service. No credentials are copied.
set -euo pipefail
if [[ -z "${PREFIX:-}" ]] || ! command -v sv >/dev/null 2>&1; then
  echo 'Jalankan di Termux setelah: pkg install termux-services' >&2
  exit 2
fi
sigheat_device="${1:-}"
if [[ ! "$sigheat_device" =~ ^[A-Za-z0-9_-]{1,48}$ ]]; then
  echo 'Pemakaian: bash scripts/install-termux-service.sh hp-masir' >&2
  exit 2
fi
sigheat_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
sigheat_service="$PREFIX/var/service/sigheat-edge"
sigheat_logs="$HOME/.local/state/sigheat-edge/log"
if [[ -e "$sigheat_service" ]]; then
  echo 'Layanan sigheat-edge sudah ada. Hentikan dan periksa konfigurasi yang ada terlebih dahulu.' >&2
  exit 2
fi
umask 077
mkdir -p -- "$sigheat_service/log" "$sigheat_logs"
touch "$sigheat_service/down"
{
  printf '#!%s/bin/bash\n' "$PREFIX"
  printf 'exec 2>&1\nexec bash %q %q\n' "$sigheat_root/scripts/termux-run.sh" "$sigheat_device"
} > "$sigheat_service/run"
{
  printf '#!%s/bin/bash\n' "$PREFIX"
  printf 'exec svlogd -tt %q\n' "$sigheat_logs"
} > "$sigheat_service/log/run"
printf 's1000000\nn5\n' > "$sigheat_logs/config"
chmod 700 "$sigheat_service/run" "$sigheat_service/log/run"
echo 'Layanan dipasang dalam keadaan berhenti. Tutup dan buka sesi Termux jika termux-services baru dipasang.'
echo 'Mulai: sv-enable sigheat-edge && sv up sigheat-edge'
echo 'Status: sv status sigheat-edge'
echo 'Hentikan: sv-disable sigheat-edge'
printf 'Log: tail -f %q/current\n' "$sigheat_logs"
