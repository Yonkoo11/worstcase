#!/usr/bin/env bash
set -euo pipefail

image="${WORSTCASE_ISOLATION_TEST_IMAGE:-alpine:latest}"
docker image inspect "$image" >/dev/null

base=(docker run --rm --network none --read-only --cap-drop ALL --security-opt no-new-privileges --pids-limit 32 --memory 64m --cpus 0.25 --user 65532:65532 --tmpfs /tmp:rw,noexec,nosuid,size=1m "$image")

identity="$("${base[@]}" id)"
[[ "$identity" == *"uid=65532 gid=65532"* ]]

if "${base[@]}" touch /blocked 2>/dev/null; then
  echo "root filesystem unexpectedly writable" >&2
  exit 1
fi

"${base[@]}" touch /tmp/allowed
route_lines="$("${base[@]}" wc -l /proc/net/route)"
[[ "${route_lines//[[:space:]]/}" == "1" ]]

echo "adapter container isolation verified: non-root, read-only root, bounded tmpfs, no network route"
