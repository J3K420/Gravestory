# GraveStory mobile guidance

Before changing mobile code or configuration:

1. Read the repository-root `AGENTS.md` and `project-context.md`.
2. For ordinary work, require the Expo SDK major declared in `package.json` to match the resolved lockfile major. If they disagree, ordinary mobile work remains blocked; proceed only within an explicitly identified SDK-transition task approved by James and governed by step 4.
3. Consult the matching versioned official Expo documentation and the pinned official library or platform documentation relevant to the changed surface; never assume the latest versions. This scoped rule governs SDK-documentation selection over stale version notes in broader project documents. If matching documentation is unavailable, stop and report it unless James approves a named authoritative alternative.
4. For an Expo SDK transition, identify the source and target versions, consult both versioned documentation sets and the official migration guide, and update the canonical manifest and lockfile declarations together.
5. Presume changes to native dependencies, plugins, permissions, or app configuration require a new native build. An OTA is eligible only when the reviewed diff changes none of those native surfaces, the repository-root `tools/deploy-config.mjs` and `tools/verify-repo.mjs` confirm compatibility identity, and the matching Expo Updates/runtime guidance permits it; otherwise require a native build.
