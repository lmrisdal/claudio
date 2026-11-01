#!/usr/bin/env bash
set -euo pipefail

image="${1:?Usage: smoke-container.sh <image>}"
name="claudio-smoke-$$"
cleanup() {
  if [ "$?" -ne 0 ]; then
    docker logs "$name" || true
  fi
  docker rm -f "$name" > /dev/null 2>&1 || true
}
trap cleanup EXIT

docker run --detach --name "$name" --publish 127.0.0.1::8080 "$image"
port="$(docker port "$name" 8080/tcp | cut -d: -f2)"
for attempt in $(seq 1 60); do
  if curl --fail --silent "http://127.0.0.1:${port}/health" > /dev/null; then
    curl --fail --silent "http://127.0.0.1:${port}/" | grep -q 'id="root"'
    echo "Container serves health endpoint and frontend"
    exit 0
  fi
  if [ "$(docker inspect --format '{{.State.Running}}' "$name")" != true ]; then
    echo 'Container exited before becoming healthy' >&2
    exit 1
  fi
  sleep 2
done
echo 'Container did not become healthy within 120 seconds' >&2
exit 1
