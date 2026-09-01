# Versioning And Packaging

Apply this policy to every package release:

- A release containing bug fixes only increments PATCH: `X.Y.Z -> X.Y.(Z+1)`.
- A backward-compatible feature release increments MINOR and resets PATCH: `X.Y.Z -> X.(Y+1).0`.
- A very large or breaking release increments MAJOR and resets both lower components: `X.Y.Z -> (X+1).0.0`.
- A release with mixed change types uses the highest applicable category.
- Rebuilding the same intended release does not increment the version a second time.

Before packaging, determine the change category since the last published release; update `merc32-vsce/package.json`, both package version fields in `merc32-vsce/package-lock.json`, and the version badge in `merc32-vsce/README.md`; commit the version metadata before the final provenance build; package; verify `extension/package.json` inside the VSIX equals source; run the repository VSIX smoke.
