# docker index

17 pages. Docker builds applications into images and runs them as isolated containers on a Docker engine, on your laptop, a CI runner or a server.

| Page | File | Covers |
| --- | --- | --- |
| Docker | `_overview.md` | Docker builds applications into images and runs them as isolated containers on a Docker engine, on your laptop, a CI runner or a server. |
| Build caches | `build-caches.md` | Keep an image's build layers in a registry or GitHub Actions cache, so fresh CI runners skip the steps that didn't change. |
| Build images | `build-images.md` | Build an image from a Dockerfile with Docker.Image — build args, multi-stage targets, platforms, build secrets — and know when a deploy rebuilds it. |
| Images on cloud runtimes | `cloud-runtimes.md` | Hand a pushed image's reference or digest to ECS, Cloudflare Containers, Cloud Run or Kubernetes, let those runtimes build with your local Docker, and write Dockerfiles inline with Dockerfile.inline. |
| Containers | `containers.md` | Run an image as a Docker.Container — start it, publish ports, pass secrets through its environment, health-check it, reach the host — and know which changes recreate it. |
| Effectful services | `effectful-services.md` | Write a Swarm service as an Effect program in your own code — Alchemy bundles it into an image on the swarm's engine, serves its fetch handler, runs its background loops and gives it the Config it reads. |
| Engines & contexts | `engines-and-contexts.md` | How a Docker context chooses the engine a resource lands on — the CLI's current context, a Docker.Context over SSH or TCP, an existing context by lookup — and who can reach an engine. |
| Limits & security | `limits-and-security.md` | Cap a container's memory, CPU and processes, run it as an unprivileged user with a read-only filesystem and no capabilities, apply seccomp and AppArmor profiles, and rotate its logs. |
| Local Postgres | `local-services.md` | Run Postgres for local development as Stack resources — a pinned image, a network and a volume, a Redacted password, and a health-checked container. |
| Networks | `networks.md` | Connect containers on a Docker.Network so they reach each other by name, cut a network off from the internet, pin its subnet, and attach to networks you didn't create. |
| Registries & credentials | `registries.md` | Give an image its registry credentials as a Redacted Config value, push without docker login, pull private base images, and read the password from a secrets manager per stage. |
| Pull & mirror images | `remote-images.md` | Pull an existing image with Docker.RemoteImage, pin it so deploys stop re-pulling, and re-tag and push it into your own registry. |
| Services | `services.md` | Run replicated containers on a swarm with Docker.Service — publish ports through the routing mesh, roll out new images with automatic rollback, connect services on overlay networks, mount Swarm secrets, and place tasks on nodes. |
| Setup | `setup.md` | Install @alchemy.run/docker, register its providers, and point Alchemy at a Docker or Podman engine. |
| Swarms | `swarm.md` | Turn an engine into a swarm with Docker.Swarm, locally or on a server over SSH, use a swarm you didn't create, and grow it to more nodes. |
| Volumes | `volumes.md` | Keep a container's data in a Docker.Volume so it survives the container being recreated, mount host directories, and know when a volume and its data are deleted. |
| What is Docker? | `what-is-docker.md` | The concepts behind Docker — engines and contexts, images and Dockerfiles, registries, containers, networks, volumes and Swarm — and how @alchemy.run/docker models each of them. |
