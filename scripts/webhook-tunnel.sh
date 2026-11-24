#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
command -v cloudflared >/dev/null || { echo 'cloudflared is required' >&2; exit 1; }
log_file="$(mktemp)"
proxy_pid=''
tunnel_pid=''
cleanup() {
    for pid in "$tunnel_pid" "$proxy_pid"; do
        if [[ -n "$pid" ]]; then
            kill "$pid" 2>/dev/null || true
            wait "$pid" 2>/dev/null || true
        fi
    done
    rm -f "$log_file"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

python3 "$root/scripts/webhook_proxy.py" &
proxy_pid=$!
for ((attempt = 0; attempt < 30; attempt++)); do
    kill -0 "$proxy_pid" 2>/dev/null || { echo 'Webhook proxy failed to start' >&2; exit 1; }
    if curl -fsS --max-time 1 -o /dev/null -X OPTIONS http://127.0.0.1:8099/interview/transcript 2>/dev/null; then
        break
    fi
    sleep 0.1
done
if (( attempt == 30 )); then
    echo 'Webhook proxy did not become ready' >&2
    exit 1
fi

cloudflared tunnel --url http://127.0.0.1:8099 >"$log_file" 2>&1 &
tunnel_pid=$!
for ((attempt = 0; attempt < 60; attempt++)); do
    public_url="$(grep -Eom1 'https://[a-z0-9-]+\.trycloudflare\.com' "$log_file" || true)"
    if [[ -n "$public_url" ]]; then
        webhook_url="$public_url/interview/transcript"
        printf '%s\n' "$webhook_url" > "$root/.webhook-url"
        printf 'VITE_DEEPBRIDGE_WEBHOOK_URL=%s\n' "$webhook_url"
        while kill -0 "$tunnel_pid" 2>/dev/null && kill -0 "$proxy_pid" 2>/dev/null; do
            sleep 1
        done
        cat "$log_file" >&2
        exit 1
    fi
    kill -0 "$tunnel_pid" 2>/dev/null || break
    sleep 1
done
echo 'Cloudflare did not provide a public tunnel URL' >&2
cat "$log_file" >&2
exit 1
