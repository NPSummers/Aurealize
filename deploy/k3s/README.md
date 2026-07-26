# k3s deployment

The application runs as one Podman-built container. Elysia listens on container port `3000`, the Kubernetes Service exposes it on port `80`, and Traefik routes `aurealize.aureal.dev` over its plain HTTP `web` entrypoint. Cloudflare Tunnel handles the public HTTPS connection.

Keep the production database, Resend, sender, and administrator values in the project-root `.env`. The file is turned into the `aurealize-cards-env` Kubernetes Secret during deployment and is never copied into the image.

Run this from the project root on the single k3s node:

```sh
sh deploy/k3s/deploy.sh
```

The script:

1. Builds `localhost/aurealize-cards:latest` with `podman build`.
2. Imports it into the local k3s containerd image store.
3. Creates or updates the Kubernetes Secret from `.env`.
4. Applies the manifests and waits for rollout.

The single-replica Deployment uses the `Recreate` strategy. The old process closes its HTTP listener and Postgres pool on shutdown before the replacement starts.

The Deployment uses `imagePullPolicy: Never` because the Podman image is imported directly into k3s containerd instead of being pulled from a registry.

For Cloudflare Tunnel, send `aurealize.aureal.dev` to Traefik on HTTP port `80`. If `cloudflared` runs inside the cluster, the service target is typically:

```text
http://traefik.kube-system.svc.cluster.local:80
```

The app origin remains `https://aurealize.aureal.dev` because that is the public browser origin required by passkeys.
