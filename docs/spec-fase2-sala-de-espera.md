# Spec — Fase 2: sala de espera 3D

Contexto: `DESIGN.md` (fase 2), `docs/spec-fase1-multijugador.md` (lo ya hecho). La fase 1 y sus ajustes están en el repo: salas con propietario, ajustes (`settings`), lobby 2D en estilo cinta de vídeo (`client/src/game/Lobby.tsx`), avatares remotos (`remote.ts`), chat, servidor autoritativo (`server/src/`), protocolo en `shared/src/index.ts`. Monorepo npm workspaces; puertos 5180 (cliente) y 5181 (servidor).

## Objetivo
Al entrar en una sala (fase `lobby`) el jugador ya no ve una lista de texto: está de pie, en primera persona, en una **sala de espera 3D** con los demás. Hay un **ordenador** (abre los ajustes de la sala; en la fase 3 también el armario de cosméticos) y, junto a una **puerta cerrada**, un **botón industrial** que solo puede pulsar el propietario. Al pulsarlo la puerta se abre hacia las Backrooms, todas las cámaras cruzan el umbral con una animación y la partida empieza con todos.

La lista de salas (sin sala) sigue siendo el panel 2D de la fase anterior; solo cambia lo que se ve **dentro** de una sala.

## Reglas del proyecto (obligatorias)
- Solución más simple que funcione (ponytail). Sin tests; verifica con scripts desechables en el scratchpad y con el navegador (panel del navegador visible; si no, el lienzo mide 0 y la carga falla).
- Sin dependencias nuevas salvo que sean imprescindibles. No hagas commits. No toques `E:\s7lver2`, ni `grips.json`, ni la lista de salas.
- UI nueva en el OSD de camcorder de los 90 del resto (`backrooms.css`): sin cajas redondeadas, píldoras, glows ni degradados morado-azul. Textos de UI de lobby en español, como el resto del lobby.
- `npm run typecheck` y `npm run build -w client` limpios. El juego en solitario y las partidas en sala existentes siguen funcionando igual.
- El peso importa (se despliega en Vercel): ver "Modelos".

## Modelos
Hay fuentes en `client/public/*.zip` (gitignored, solo fuente): `old_computer.zip` y `industrial_button.zip` (glTF con texturas PNG de varios MB). La puerta puede ser `client/public/models/backrooms/door.glb` (ya existe). Para la sala hazla procedural (baldosas, techo con fluorescente, zócalo), con el mismo lenguaje que `tvRoom.ts`.
- Extrae cada zip a una carpeta temporal propia (no ejecutes nada de dentro), convierte a un `.glb` único en `client/public/models/waiting/` con texturas reducidas (≤ 1024 px, preferible ≤ 512; JPEG/WebP si el cargador lo admite). Objetivo: cada modelo < 1,5 MB. Si hace falta un script, déjalo en `tools/` y documenta cómo se ejecuta. Conserva los `license.txt` junto a los modelos (`models/waiting/LICENSES.txt`).
- Cárgalos con el cargador que ya usa el juego (`game.ts` / `compile.ts`); no añadas otro.

## Protocolo (`shared/src/index.ts`)
- `Phase`: añade `'starting'`. Al `start`, el servidor pone la sala en `starting` durante `START_DELAY` ms (4500) y luego `playing`; `room` se emite en cada cambio. Durante `starting` no se acepta unirse ni `settings`.
- `state` y `players` (15 Hz) también valen en fase `lobby` y `starting`: son las posiciones en la sala de espera. Misma forma `PlayerState`; en el lobby las coordenadas son locales de la sala de espera.
- `start` sigue siendo solo del propietario y solo en `lobby`.
- El servidor sigue siendo el que decide: valida que `start` lo manda el propietario; limita los estados en lobby a la caja de la sala (clamp) para que no se pueda teletransportar fuera.

## Hitos (en orden; cada uno compila y es jugable antes de seguir)

### M1 — La sala y su cámara
- `client/src/game/waiting.ts` (nombre libre): escena Three de una sala pequeña (≈ 6 × 5 m): suelo de baldosas, paredes, techo con un fluorescente que parpadea poco, zócalo; mismo tono sucio-amarillento y mismo pipeline de render que el juego (composer, VHS, bloom) para que no parezca otro juego. Una pared con la **puerta cerrada** (hoja con marco, luz fría/cálida por debajo para insinuar lo que hay detrás) y el **botón industrial** en un pedestal o en la pared a su lado; el **ordenador viejo** sobre una mesa en otra pared.
- Control en primera persona dentro de la sala: ratón + WASD, colisión simple contra las paredes y los muebles (AABB). Reutiliza `input.ts`; no reutilices el `World` del laberinto.
- Entrar en una sala (`room.phase === 'lobby'`) monta esta escena sobre el menú; salir, vuelve a la lista. Reutiliza el `BackroomsGame` (renderer, assets, composer) en vez de crear otro renderer.

### M2 — Los demás
- Los jugadores de la sala aparecen como avatares (`Remote`) en la sala de espera con su nombre flotante y su animación de andar/quieto; se mandan y reciben estados en lobby a 15 Hz, con la misma interpolación que en partida. Posiciones de aparición separadas por jugador (hasta 4).
- Linterna apagada en la sala de espera (no hay haz). Cabeza y mirada visibles (yaw/pitch).
- Chat con `ChatInput`/`ChatLog` sobre la escena: Intro abre el chat (suelta el puntero, no mueve al escribir), igual que en partida.

### M3 — El ordenador y los ajustes
- Acercarse al ordenador y pulsar `E` (aviso de interacción en el estilo de `hint` del juego) abre una vista de **pantalla de ordenador**: la cámara hace un acercamiento suave a la pantalla y se superpone el panel de ajustes (el mismo contenido que ya tiene `Lobby.tsx` en su rama de sala: nombre, visibilidad, jugadores, semilla, dificultad) con aspecto de terminal CRT. Solo el propietario edita; los demás lo ven en lectura. Esc o `E` cierra y vuelve la cámara.
- Extrae el panel de ajustes de `Lobby.tsx` a un componente reutilizable; no lo dupliques.
- En la pantalla, una pestaña (o línea) `ARMARIO` deshabilitada con el texto «PRÓXIMAMENTE» para que la fase 3 la rellene.
- Mientras un jugador está en el ordenador, su avatar para los demás se queda de pie mirándolo (no hace falta más).

### M4 — Puerta, botón y entrada
- Cerca del botón y mirándolo, `E`: si eres el propietario → `start`; si no, aviso «SOLO EL PROPIETARIO». El botón se hunde al pulsarlo (animación corta + clic de audio, reutiliza `audio.ts`).
- Fase `starting` (4,5 s): en **todos** los clientes se juega una secuencia: el botón se hunde, la luz del fluorescente parpadea y cae, la puerta se abre girando sobre sus goznes dejando entrever un pasillo de las Backrooms (puede ser un plano emisivo amarillo con ruido), la cámara pasa a automática y avanza hacia el umbral (movimiento de cámara en mano, ligero balanceo), fundido a negro con el zumbido del juego subiendo. Los mandos quedan suspendidos mientras dure.
- Al terminar (fase `playing` en el cliente), se desmonta la sala de espera y se arranca la partida igual que hoy (`enterMatch`, semilla, recursos, avatares). Si la animación aún no ha terminado cuando llega `playing`, espera a que acabe; nunca arranques con la animación a medias ni la dejes colgada.
- Fin de partida: vuelve al lobby de la sala (como ahora) y por tanto a la sala de espera, con la puerta cerrada otra vez.

### M5 — Pulido y robustez
- La pantalla «ENTRAR» de la fase anterior (para pedir el clic del puntero) se integra: pulsar sobre la escena captura el puntero; Esc lo suelta y muestra la pausa del lobby (SALIR DE LA SALA).
- Si el servidor cae o hay mantenimiento mientras se está en la sala, el aviso ya existente se muestra encima de la escena y no se rompe nada.
- Rendimiento: la sala de espera no debe costar más que la partida (pocas luces reales, sin sombras caras; el resto, baked/emisivo). Libera geometrías, texturas y listeners al salir.
- Prefers-reduced-motion: la entrada por la puerta se acorta y sin balanceo.

## Verificación (haz esto antes de informar)
1. `npm run typecheck` y `npm run build -w client` sin errores. Pesos finales de `client/public/models/waiting/` (lista con tamaños).
2. Script desechable con `socket.io-client`: dos clientes en una sala, estados en lobby (con clamp), `start` solo del propietario, `starting` → `playing` tras `START_DELAY`, `settings` rechazado en `starting`.
3. Navegador con dos pestañas (panel visible): se ven en la sala, el chat funciona, el ordenador abre los ajustes y los cambios del propietario llegan a la otra pestaña, el botón arranca a ambos y la partida empieza con los dos dentro. Capturas de la sala, de la pantalla del ordenador y de la puerta abriéndose.
4. Juego en solitario y lista de salas intactos.

## Informe final (breve)
Hitos completados, lo que falta, archivos nuevos/tocados, pesos de modelos, cómo probarlo con dos pestañas, decisiones tomadas que no estén aquí.

## Fuera de alcance
Cuentas, armario real, cosméticos, niveles nuevos, voz, otros mapas de sala de espera.
