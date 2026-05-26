---
"@ai-hero/sandcastle": patch
---

Add a `groups` option to the Docker and Podman sandbox providers that maps to `--group-add` flags, granting the container user supplementary group membership (e.g. for a bind-mounted Docker socket). Accepts group names or numeric GIDs; when omitted, no `--group-add` flags are added.
