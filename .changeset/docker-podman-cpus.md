---
"@ai-hero/sandcastle": patch
---

Add a `cpus` option to the Docker and Podman sandbox providers that maps to the `--cpus` flag on `docker run` / `podman run`, limiting the CPU resources available to the container. Accepts fractional values (e.g. `1.5`); when omitted, the container is left unconstrained.
