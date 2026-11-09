# Backrooms

Co-op (2-4 players) multiplayer Backrooms horror game. Monorepo (npm workspaces): `shared/` (pure seeded game logic and protocol types), `server/` (Node + Socket.IO, authoritative), `client/` (Vite + React + Three.js).

```
npm install
python tools/build.py            # dev: client http://localhost:5180, server :5181
python tools/build.py --check    # typecheck
python tools/build.py --build    # production client build
```

Documentation index: [docs/README.md](docs/README.md) (architecture, spec/protocol, glossary, contributor guide for LLMs).

## Local review

Based on [s7lver2/backrooms](https://github.com/s7lver2/backrooms), upstream commit3ad9198. Corrections and verification notes are in [docs/REVISION-LOCAL.md](docs/REVISION-LOCAL.md). Run `npm test` for targeted regressions. Server admin access requires an existing account ID explicitly configured with `ADMIN_UID`.
