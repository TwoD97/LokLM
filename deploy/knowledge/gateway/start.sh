#!/bin/sh
set -eu
umask 077
# Only a DNS hostname is interpolated; never interpolate certificates or secrets.
case "${LOKLM_TLS_HOST:-}" in
  ''|*[!a-zA-Z0-9.-]*|.*|*..*|*.) echo 'Set a valid ASCII TLS DNS hostname' >&2; exit 2 ;;
esac
if ! printf '%s\n' "$LOKLM_TLS_HOST" | awk '
  length($0)>253 {exit 1}
  {n=split($0,a,"."); if(n<2)exit 1; for(i=1;i<=n;i++) if(length(a[i])>63 || a[i] ~ /^-/ || a[i] ~ /-$/)exit 1}
'; then
  echo 'TLS hostname must contain valid DNS labels' >&2
  exit 2
fi
test -s /run/tls/fullchain.pem && test -r /run/tls/fullchain.pem
test -s /run/tls/privkey.pem && test -r /run/tls/privkey.pem
envsubst '${LOKLM_TLS_HOST}' < /gateway/nginx.conf.template > /tmp/nginx.conf
nginx -t -q -c /tmp/nginx.conf
exec nginx -c /tmp/nginx.conf -g 'daemon off;'
