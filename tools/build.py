"""Levanta el cliente (Vite) y el servidor (Node + Socket.IO), o hace el build del cliente.

  python tools/build.py            dev: cliente en :5180 y servidor en :5181
  python tools/build.py release    release: build del cliente, `vite preview` en :5180 y el servidor con `start`
  python tools/build.py --build    build de producción del cliente (client/dist)
  python tools/build.py --check    typecheck de cliente y servidor
"""
import socket
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CLIENT_PORT, SERVER_PORT = 5180, 5181  # los mismos que shared/src/index.ts


def run(cmd: str) -> int:
    return subprocess.call(cmd, shell=True, cwd=ROOT)


def main() -> int:
    if not (ROOT / "node_modules").exists() and run("npm install"):
        return 1
    if "--build" in sys.argv:
        return run("npm run build -w client")
    if "--check" in sys.argv:
        return run("npm run typecheck")
    for port in (CLIENT_PORT, SERVER_PORT):  # un servidor viejo en el puerto: avisar claro en vez de morir a medias
        with socket.socket() as s:
            if s.connect_ex(("127.0.0.1", port)) == 0:
                print(f"el puerto {port} ya está en uso (otro dev/preview sin cerrar). Libéralo con:\n"
                      f'  powershell -c "Stop-Process -Id (Get-NetTCPConnection -LocalPort {port} -State Listen).OwningProcess -Force"')
                return 1
    release = "release" in sys.argv or "--release" in sys.argv
    if release and run("npm run build -w client"):  # release: build del cliente y servidor en `start` (sin recarga ni watch)
        return 1
    print(f"{'release' if release else 'dev'} · cliente http://localhost:{CLIENT_PORT}  ·  servidor http://localhost:{SERVER_PORT}")
    procs = [
        subprocess.Popen(f"npm run {'start' if release else 'dev'} -w server", shell=True, cwd=ROOT),
        subprocess.Popen(f"npm run {'preview' if release else 'dev'} -w client", shell=True, cwd=ROOT),
    ]
    try:
        return procs[1].wait()
    except KeyboardInterrupt:
        return 0
    finally:
        for p in procs:
            p.terminate()


if __name__ == "__main__":
    sys.exit(main())
