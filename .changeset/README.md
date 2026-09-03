# Changesets

Create one patch changeset for each user-visible change. CI owns versioning, publishing, tags, and
GitHub Releases. `pi-cursor-inference@0.0.0` is the name-reservation bootstrap; the first functional
release is `0.0.1`.

Never edit `package.json` versions or `CHANGELOG.md` manually. A release change lands as a changeset,
then `changesets/action` opens the Version Packages PR. Merging that PR is what authorizes the OIDC
publish run.
