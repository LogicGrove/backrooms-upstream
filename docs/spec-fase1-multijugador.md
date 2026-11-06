# Spec — Fase 1: salas y multijugador básico

Contexto: `DESIGN.md` (decisiones) y `ROADMAP.md`. Monorepo npm workspaces: `shared/`, `server/` (Node + Socket.IO), `client/` (Vite + React + Three 0.160). Puertos fijos: cliente 5180, servidor 5181 (`shared/src/index.ts`). Hoy el servidor solo reparte estados de jugador y el juego es 100 % del cliente.

## Objetivo
Hasta 4 jugadores en la misma partida de Backrooms: se ven, comparten laberinto, cintas, objetos y entidades; si te atrapan pasas a espectador; hay chat. Servidor autoritativo.

## Reglas del proyecto (obligatorias)
- Solución más simple que funcione (ponytail). Sin tests; verifica con scripts desechables en el scratchpad o con el navegador.
- Sin dependencias nuevas salvo `socket.io-client` en el cliente. `tsx` o similar solo si ya está en `server/package.json`.
- `E:\s7lver2\webpage` (portfolio) NO se toca. No hagas commits. No toques `grips.json` ni el aspecto visual existente.
- Sigue `.claude/CLAUDE.md` para cualquier UI nueva (nada de píldoras con glow, cards apiladas, gradientes morado-azul); reutiliza el estilo de `backrooms.css`.
- Mantén `npm run typecheck` y `npm run build -w client` limpios. El juego en solitario (`/?seed=7&god`) debe seguir funcionando igual sin servidor.

## Protocolo (en `shared/src/index.ts`)
- `Room { code, public, ownerId, max: 4, phase: 'lobby' | 'playing' | 'over', seed }`.
- Cliente → servidor: `create({name, public}, cb)`, `join({code, name}, cb)`, `list(cb)` (salas públicas con plazas libres), `start()` (solo el propietario), `state(PlayerState)`, `pickup(itemId)`, `chat(text)`, `leave()`, `exit()` (llega a la salida).
- Servidor → cliente: `room(Room & {players})` en cada cambio de sala, `players(...)` a 15 Hz, `world(snapshot)` a 10 Hz (entidades y objetos recogidos), `chat({id,name,text})`, `dead(id)`, `over({won})`.
- Código de sala: 5 letras mayúsculas sin ambiguas. Nombre ≤ 16 chars; chat ≤ 200 chars, máx. 1 mensaje por 0,5 s por jugador, se escapa/trata como texto (React ya escapa; no uses `dangerouslySetInnerHTML`).
- El propietario pasa al siguiente jugador si sale. Sala vacía → se borra.

## Hitos (en orden; cada uno compila y es jugable antes de seguir)

### M1 — Salas y lobby
- Servidor: `create/join/list/start/leave`, límites, propietario, fase. `start` genera la `seed` y pasa a `playing`.
- Cliente: pantalla de lobby en `App.tsx`/nuevo `Lobby.tsx` (nombre, crear sala pública/privada, unirse por código, lista de públicas, jugadores de la sala, botón EMPEZAR solo para el propietario). Estado de conexión visible ("despertando servidor…" si tarda > 3 s, por Render gratis). URL del servidor por `import.meta.env.VITE_SERVER_URL`, por defecto `http://localhost:5181`. CORS del servidor: permitir también `VITE_CLIENT_ORIGIN`/env `CLIENT_ORIGIN` si existe.
- Jugar en solitario sigue disponible sin conexión.

### M2 — Mundo y avatares compartidos
- Mueve `maze.ts` (no tiene imports) a `shared/src/maze.ts` y reexpórtalo en el cliente para no cambiar imports. El servidor lo usa con la `seed`.
- Al empezar, el cliente inicia `Game.start(seed)` con la seed de la sala.
- Avatares remotos: clase `Remote` (usa `Rig` + hazmat clonado, como el jugador/entidades) con interpolación de `PlayerState` a 15 Hz; reproducen su `anim`; linterna encendida si la llevan (añade `light: boolean` y `held: string` a `PlayerState`). Nombre flotante opcional, sin DOM pesado.
- Rendimiento: no más de 3 avatares remotos; reutiliza clones.

### M3 — Cintas, objetos y salida compartidos
- El servidor genera la lista de objetos (cintas, linternas, cámara, etc.) desde la seed igual que lo hace el cliente hoy; mira `items.ts`/`maze.ts` para ver qué es determinista. Un `pickup(id)` válido lo quita para todos (el primero gana); el servidor valida cercanía con la última posición conocida.
- Objetivo común: las cintas recogidas cuentan para todos; la salida se abre con el total que ya exige el juego. `exit()` válido → `over({won:true})`.
- Inventario/fotos siguen siendo individuales.

### M4 — Entidades autoritativas
- La IA de `entity.ts` (rutas con `bfs`, visión, velocidad) pasa a correr en el servidor, sin THREE: extrae la lógica de movimiento/objetivo a `shared/src/` y deja en `entity.ts` solo la parte visual, que lee posición/estado del `world` snapshot e interpola. El servidor elige a quién persigue (el más cercano visible).
- El estado de una entidad: `{id, kind, x, z, yaw, state, hp}`. Si una parte de la lógica (disparos, daño con la pistola, cámara que aturde) depende de efectos del cliente, envía el evento al servidor (`hit(entityId)`) y que decida.
- Si esto resulta demasiado grande, termina M1–M3, deja M4 documentado en el informe con lo que falta y no dejes el juego a medias.

### M5 — Muerte, espectador y fin
- Atrapado → `dead(id)`. El muerto pasa a modo espectador: cámara siguiendo a un compañero vivo, cambiar con las flechas/Tab, texto "ESPECTADOR". Si mueren todos → `over({won:false})`.
- Pantalla final reutiliza la actual ("INSERT TAPE") y vuelve al lobby de la sala (el propietario puede empezar otra).

### M6 — Chat
- Chat de texto en lobby y en partida: Enter abre/cierra, historial corto (últimos 6, se desvanecen), sin tapar el HUD de misión; el input captura el teclado (no mover al escribir).

## Verificación (haz esto antes de informar)
1. `npm run typecheck` y `npm run build -w client` sin errores; arranca con `python tools/build.py`.
2. Script desechable (en el scratchpad) con dos clientes `socket.io-client` que crean/unen sala, empiezan, mandan estados, recogen el mismo objeto a la vez (solo uno gana), mandan chat (límite de ritmo) y salen (relevo de propietario, sala vacía borrada).
3. En el navegador con dos pestañas (el panel del navegador debe estar visible) comprueba lobby, que se ven los avatares y que el laberinto coincide (`__maze(seed)` / misma seed).
4. Juego en solitario intacto.

## Informe final (breve)
Hitos completados, lo que falta, archivos nuevos/tocados, cómo arrancar y probar con dos pestañas, y cualquier decisión que hayas tomado que no esté aquí.

## Fuera de alcance
Cuentas, sala de espera 3D con ordenador, cosméticos, niveles nuevos, voz. Los modelos de `client/public/*.zip` (sombreros, ordenador, botón, poolrooms…) son para las fases 2–4; no los extraigas ahora.
