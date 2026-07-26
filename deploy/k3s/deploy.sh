#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PROJECT_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd)
IMAGE_NAME=${IMAGE_NAME:-aurealize-cards:latest}
IMAGE_ARCHIVE=$(mktemp "${TMPDIR:-/tmp}/aurealize-cards.XXXXXX.tar")

cleanup() {
  rm -f "$IMAGE_ARCHIVE"
}
trap cleanup EXIT

cd "$PROJECT_ROOT"

if [ ! -f .env ]; then
  echo "Missing $PROJECT_ROOT/.env"
  exit 1
fi

podman build -f Containerfile -t "$IMAGE_NAME" .
podman save --format oci-archive -o "$IMAGE_ARCHIVE" "$IMAGE_NAME"
sudo k3s ctr images import "$IMAGE_ARCHIVE"

sudo k3s kubectl apply -f deploy/k3s/namespace.yaml
sudo k3s kubectl -n aurealize create secret generic aurealize-cards-env \
  --from-env-file=.env \
  --dry-run=client \
  -o yaml |
  sudo k3s kubectl apply -f -

sudo k3s kubectl apply -k deploy/k3s
sudo k3s kubectl -n aurealize rollout restart deployment/aurealize-cards

if ! sudo k3s kubectl -n aurealize rollout status deployment/aurealize-cards --timeout=180s; then
  echo "Rollout did not finish. Current pods:"
  sudo k3s kubectl -n aurealize get pods -o wide
  echo "Recent namespace events:"
  sudo k3s kubectl -n aurealize get events --sort-by=.lastTimestamp
  exit 1
fi

echo "Aurealize is deployed for https://aurealize.aureal.dev"
