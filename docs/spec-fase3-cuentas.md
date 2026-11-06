# Spec — Fase 3: cuentas, logros en servidor y armario

Contexto: `DESIGN.md` (fase 3 y decisiones), fases 1–2 ya hechas (salas, sala de espera 3D, ordenador con pestañas ROOM/WARDROBE en `client/src/game/Computer.tsx` con `saveLook()`/`loadLook()` como único punto de enganche local, vista previa de avatar). Monorepo `shared/ server/ client/`. Cliente y servidor comparten origen en dev (el Vite hace proxy de `/socket.io` y `/status` al :5181; amplía el proxy para `/api`). En producción irán separados (Vercel + Render) con `VITE_SERVER_URL`.

## Objetivo
Cuentas con usuario y contraseña **sin email**, guardadas con seguridad; **logros** concedidos por el **servidor**; **cosméticos** (colores y accesorios) que se desbloquean con logros, se eligen en el ordenador de la sala de espera y **se ven en multijugador**; pantalla principal con inicio de sesión, y también puedes jugar de **invitado** (sin persistencia).

## Reglas (obligatorias)
- Solución más simple que funcione (ponytail). Sin tests; verifica con scripts desechables y navegador (panel visible; si no, el lienzo mide 0).
- No commits. No toques `E:\s7lver2`, `grips.json`. Todo texto de UI en **inglés**, estética OSD de camcorder de los 90 de `backrooms.css` (sin píldoras, glows, degradados morado-azul, cards apiladas).
- `npm run typecheck` y `npm run build -w client` limpios; el servidor (:5181, `tsx watch`) y el Vite (:5180) ya corren, no los reinicies (el Vite se cuelga si tocas `vite.config.ts`; si añades el proxy `/api` deja claro que habrá que reiniciarlo y no lo hagas tú: dilo en el informe).
- Seguridad de verdad (no atajos):
  - Contraseñas con **argon2id** (`@node-rs/argon2`, binarios precompilados, nada de compilar nativo; parámetros recomendados por OWASP: memoria ≥ 19 MiB, t ≥ 2, p = 1). Nunca cifrado reversible, nunca guardar ni registrar contraseñas en claro (ni en logs de errores).
  - Sesión: id aleatorio de 32 bytes (`crypto.randomBytes`) en cookie **httpOnly**, `SameSite=Lax` (mismo origen) y `Secure` en producción; en BD solo su **hash** (SHA-256). Caducidad 30 días deslizante; logout y cambio de contraseña la invalidan. Para despliegue cruzado (Vercel↔Render): variable `COOKIE_CROSS_SITE=1` → `SameSite=None; Secure` + CORS con `credentials` y `CLIENT_ORIGIN` estricto.
  - Anti CSRF: solo `POST` con `content-type: application/json` + comprobación de `Origin` contra la lista permitida.
  - Límite de intentos: por IP y por usuario (p. ej. 5 fallos/15 min con retardo creciente) en login, registro y recuperación; mensajes de error **genéricos** (no revelar si el usuario existe) y tiempo de respuesta uniforme (verifica un hash falso si el usuario no existe).
  - Validación: usuario 3–16 caracteres `[A-Za-z0-9_]` (único sin distinguir mayúsculas), contraseña 8–128 caracteres (sin reglas absurdas de composición), cuerpo máximo ~4 KB, nada de `dangerouslySetInnerHTML`.
  - **Código de recuperación** (sin email): al registrarse se genera uno aleatorio (≈ 20 caracteres legibles), se muestra **una vez** (con botón de copiar y casilla «I saved it») y se guarda hasta su **hash**; sirve para restablecer la contraseña (y se rota al usarlo, mostrando el nuevo).
  - Base de datos: SQLite embebido, **`node:sqlite`** (Node 22.14, sin dependencias) o `better-sqlite3` si hay un problema real; consultas parametrizadas siempre; archivo en `server/data/backrooms.db` (gitignored; ruta por `DB_PATH`); migraciones simples al arrancar.

## Modelo de datos (SQLite)
`users(id, username, username_lower UNIQUE, pass_hash, recovery_hash, created_at)`, `sessions(id_hash PK, user_id, created_at, expires_at)`, `achievements(user_id, key, unlocked_at, PRIMARY KEY(user_id,key))`, `stats(user_id, key, value)` (contadores para progreso: partidas, escapes, cintas, fotos, escondites aguantados, etc.), `loadout(user_id PK, color, head, back)`.

## Logros y cosméticos (propón y deja en un único archivo de datos en `shared/`)
Logros (el **servidor** los concede, a partir de eventos de la partida; el cliente solo los muestra) — empieza con ≈ 10, por ejemplo:
`first_escape` (escapar), `tape_hoarder` (recoger 20 cintas en total), `photographer` (sacar 10 fotos), `held_breath` (aguantar una inspección escondido), `team_player` (escapar jugando con 3+), `survivor` (escapar sin que te alcancen), `pit_fall` (caerte al vacío), `trigger_happy` (abatir 5 entidades), `night_owl` (jugar 10 partidas), `idiot` (el que ya existe).
Cosméticos: **color** (6 tintes, 2 gratis y 4 por logro), **head** (5 sombreros desde los zips de `client/public/`: `asian_conical_hat`, `bicorn_hat`, `doge_roblox_hat`, `ushanka_-_trapper_hat`, `witch_hat`) y **back** (p. ej. la batería de `battery.zip` como mochila). Tabla `cosmetic → logro requerido` en el mismo archivo.
Modelos: extrae cada zip a una carpeta temporal propia (no ejecutes nada de dentro), conviértelo con `tools/pack_glb.py` (existente; Pillow) a `client/public/models/cosmetics/*.glb`, **< 400 KB cada uno** (texturas ≤ 256–512 px), y conserva sus licencias en `LICENSES.txt`. Se acoplan al hueso `Head` / `Spine` del rig `hazmat` (usa `fit` de `player.ts` y un offset por pieza, ajustable; no necesitas herramienta de dev).

## Protocolo
- API HTTP (en el mismo servidor, con los mismos límites): `POST /api/register`, `/api/login`, `/api/logout`, `/api/recover`, `GET /api/me` (usuario, logros, estadísticas, loadout, cosméticos desbloqueados), `POST /api/loadout` (valida que cada cosmético esté desbloqueado).
- El socket autentica con la cookie de sesión al conectar (invitado si no hay). `RoomView.players[]` / `Member` incluyen `look: {color,head,back}` (solo el del jugador, validado por el servidor) y el cliente lo muestra en `Remote` y en el avatar propio de la sala de espera.
- El servidor emite `achievement` al jugador cuando concede uno (toast OSD en el cliente) y lo guarda; los eventos nacen en `match.ts` / `index.ts`: escape (`exit`), cintas, fotos, caídas, aguantar inspección, muertes de entidades, etc. Los invitados no acumulan nada.

## Hitos (en orden; cada uno compila y es usable antes de seguir)

### M1 — Servidor de cuentas
BD, registro, login, logout, `me`, recuperación, sesiones, límites, validación, cookies, CORS/Origin. Script de verificación con `fetch`: registro duplicado, mayúsculas, contraseñas cortas, login erróneo (respuesta idéntica exista o no), límite de intentos, cookies (flags), logout invalida la sesión, recuperación rota el código, ninguna contraseña ni hash aparece en logs ni en respuestas. Documenta variables de entorno en el informe.

### M2 — Pantalla principal con cuenta
En el menú: línea de estado `GUEST` / `SIGNED IN AS <name>` y opciones `SIGN IN`, `REGISTER`, `SIGN OUT`, `ACHIEVEMENTS`. Formularios sencillos en OSD (nada de modales con sombras), errores claros, mostrar el código de recuperación una vez tras registrarse, pantalla de recuperación. Pantalla `ACHIEVEMENTS`: lista con desbloqueado/bloqueado, progreso (contadores) y qué cosmético da cada uno. Invitado: juego como hasta ahora (la lista de logros muestra «Sign in to save progress»). Mejora la pantalla principal en lo visual sin romper su estética (hoy: título BACKROOMS, estática de la tele, opciones).

### M3 — Logros en el servidor
Eventos → logros en `match.ts`/`index.ts`, persistencia, contadores, `achievement` por el socket y toast en el cliente («ACHIEVEMENT UNLOCKED · NAME»). Migración opcional de los logros de `localStorage` (si hay sesión, ofrece importarlos una vez; el servidor solo acepta los que pueda justificar: simplemente `backrooms`/`idiot` si existen).

### M4 — Armario real
Pestaña `WARDROBE` de `Computer.tsx`: lee los cosméticos desbloqueados y el loadout de `GET /api/me`, muestra los bloqueados con el logro que falta, guarda con `POST /api/loadout` (sustituye `saveLook()`/`loadLook()`), vista previa con sombrero/mochila reales. Los demás jugadores lo ven (`look` en el estado de sala y en `Remote`, y tu propio avatar). Invitados: colores gratis solo en local, el resto bloqueado con «SIGN IN».

### M5 — Pulido y robustez
Si cae el servidor o hay mantenimiento, el menú sigue funcionando (modo invitado/solitario) sin romper la sesión; expiración de sesión limpia; sin fugas de memoria al montar/desmontar; reduced-motion; touch para los formularios; accesibilidad (labels, foco, errores con `role="alert"`).

## Verificación (antes de informar)
1. `npm run typecheck`, `npm run build -w client`, tamaños de los modelos de cosméticos.
2. Scripts: seguridad de M1 (ver arriba), concesión de logros por eventos, loadout rechazado si el cosmético no está desbloqueado, `look` repartido por socket y no falsificable.
3. Navegador (panel visible): registro → código de recuperación → logout → login → ver logros → cambiar el armario en el ordenador → entrar en una sala con un segundo cliente (puedes simularlo con un bot de `socket.io-client`) y comprobar que ve el sombrero. Capturas de menú, formularios, logros, armario.
4. Solitario, salas y lista de salas intactos para invitados.

## Informe final (breve)
Qué hay, variables de entorno y cómo desplegar (Render/Vercel), archivos tocados, pesos de modelos, decisiones no previstas, lo que falte, y **cualquier punto de seguridad que consideres débil**.

## Fuera de alcance
Email, OAuth, voz, niveles nuevos, moderación del chat, pagos.
