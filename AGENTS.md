# AGENTS.md

gossh manages SSH servers in bulk: an inventory, terminals in tabs, live
statistics read over SSH and commands run on many servers at once. It is a
MyGo app (Go + the system webview), built on the same standard as xdll.

Read [docs/architecture.md](docs/architecture.md) before changing code, and
[docs/development.md](docs/development.md) for the commands and rules.

- No cgo: everything builds with `CGO_ENABLED=0` (`go vet ./... && GOOS=linux go vet ./... && GOOS=darwin go build ./...`).
- The page in `web/` has no build step: classic scripts sharing globals, libraries vendored in `web/vendor`.
- One SSH connection per server (`Pool`), shared by terminals, statistics and commands.
- Host keys are always checked; never add an "accept any key" path.
- User-facing text is French; code comments are English.
- `go test ./...` must pass; `e2e_test.go` runs an SSH server in memory.
