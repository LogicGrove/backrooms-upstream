# Spec — Mapa más abierto y escondites en las paredes

Contexto: `DESIGN.md`, `docs/spec-fase1-multijugador.md`. Todo lo del mapa vive en `shared/src/maze.ts` (generación, determinista por semilla, la usan servidor y cliente) y `shared/src/sim.ts` (IA de entidades, la corre el servidor en sala y el cliente en solitario). Render del mapa: `client/src/game/world.ts` (+ `pit.ts`, `lightmap.ts`). Resultado actual: laberinto de pasillos de 1 celda (1,5 m) de ancho en una rejilla de ~56×56.

## Objetivo
1. **Mapa más abierto**: mezcla de **salas enormes** (con columnas y tabiques sueltos, sensación de espacio infinito, techo y fluorescentes repetidos hasta el fondo) conectadas por **pasillos** y **huecos amplios**. Sigue habiendo rutas, esquinas y sitios donde esconderse; deja de ser un laberinto cerrado.
2. **Huecos en las paredes donde esconderse**, con riesgo: de vez en cuando una entidad se para a mirar dentro; hay que **contener la respiración** (mantener una tecla).

## Reglas (obligatorias)
- Solución más simple que funcione (ponytail). Sin tests; verifica con scripts desechables en el scratchpad (`tsx`) y con el navegador (panel visible; si no, el lienzo mide 0).
- No commits. No toques `E:\s7lver2`, `grips.json`, la lista de salas ni `waiting.ts` / `Computer.tsx` / `RoomSettings.tsx` (otro subagente trabaja en el lobby a la vez): si necesitas tocar `game.ts`, `Backrooms.tsx`, `backrooms.css`, `shared/src/index.ts` o `server/src/index.ts`, haz cambios mínimos y localizados.
- Todo texto de UI en **inglés** (aviso «HOLD [SPACE]», etc.).
- `npm run typecheck` y `npm run build -w client` limpios. El solitario (`/?seed=7&god`) y las salas siguen funcionando; cliente y servidor deben generar **exactamente el mismo mapa** (misma función de `shared`).
- No rompas lo ya hecho: reparto de recursos por jugadores (`supply`), huecos al vacío (`voids`/`pit.ts`), cintas/cámara/rifle/linternas, salida (ascensor), lightmap y parpadeos.

## Parte 1 — Mapa abierto (en `shared/src/maze.ts`)
- Nueva generación **salas + conectores**: coloca N salas grandes (entre ≈ 9×7 y 20×15 celdas, de formas rectangulares o en L), algunas casi vacías con columnas cada pocas celdas y tabiques sueltos, otras con subdivisiones; conéctalas con pasillos de 1–2 celdas y aberturas amplias (3–6 celdas) entre salas contiguas; añade algún pasillo largo recto y alguna sala enorme (≥ 18×14) cerca del centro. Garantiza conectividad total (BFS) y que todos los recursos (inicio, cámara, cintas, ascensor, rifle) sean alcanzables.
- Mantén el **tamaño de recorrido** objetivo: el camino bueno (inicio → cámara → cintas → ascensor, `routeLength`) debe seguir dando partidas de ≈ 7–10 min; ajusta el rango objetivo y el tamaño de rejilla (hasta ≈ 84×84 si hace falta, comprueba coste en memoria/CPU).
- Conserva el contrato de `Maze` (campos y semántica) y añade campos nuevos solo si hacen falta (p. ej. `hides`, ver Parte 2). Mismas semillas pueden dar mapas distintos de los de antes: está bien.
- Rendimiento: `world.ts` / `lightmap.ts` deben escalar (comprueba resolución del lightmap, número de mallas/instancias de paredes y paneles de luz; usa instancing o fusión si el recuento sube mucho). Niebla/oscuridad a distancia acordes para que el «infinito» no cueste fps. Objetivo: la partida no baja de lo que daba antes en tu máquina de pruebas (compara fps/tiempos de generación).
- IA de entidades (`sim.ts`): revisa visión, rutas (`bfs`) y persecución en salas abiertas (más línea de visión): que no sea injusto (rango de detección acotado, tiempos de reacción), y que el coste del `bfs` no se dispare.
- Los `voids` (agujeros al vacío) deben seguir colocándose con sentido en las salas grandes; las propiedades (`props`) y las linternas/rifles extra siguen en celdas válidas.
- Script de verificación: para 200 semillas × jugadores 1..4: conectividad, recursos alcanzables, recuento de salas, tiempo de generación (< 100 ms), recorrido dentro de rango, mismo resultado en dos llamadas.

## Parte 2 — Escondites
- **Generación**: `Maze.hides: { cell: Cell; side: 0|1|2|3 }[]` (nicho en una pared: una celda de profundidad donde cabe un jugador agachado, abierto hacia un lado). ≈ 1 por cada 100–150 celdas abiertas, nunca cerca del inicio ni del ascensor, separados entre sí, no dentro de los `voids`. Deben quedar dentro de la rejilla `open`/paredes sin romper la conectividad ni cerrar pasillos.
- **Render** (`world.ts`): marco/hueco oscuro en la pared con borde sucio, suelo y fondo oscuro, un poco de polvo; reconocible desde lejos pero discreto. Entra en el lightmap como zona oscura.
- **Mecánica del jugador** (`player.ts`/`game.ts`): cerca de un hueco y mirándolo, `E` («HIDE») → entra agachado: la cámara baja y se acerca al fondo, mirada limitada (±70° de yaw respecto a la salida), no se camina, linterna apagada automáticamente, la mano baja. `E` otra vez («LEAVE») sale. Transición corta (0,4 s).
- **Riesgo (inspección)**, decide la simulación (`sim.ts`, en el servidor en sala; el mismo código en solitario): un jugador escondido **no cuenta como objetivo**, salvo que una entidad esté a ≤ 2 celdas del hueco: entonces, con probabilidad (≈ 35 %, mayor si el jugador corrió o hizo ruido hace poco), la entidad pasa a estado `inspect`: se coloca frente al hueco ~4–6 s. Durante `inspect` el jugador debe **mantener `Space`** (contener la respiración): barra HUD «HOLD [SPACE]» con aviso; la respiración dura ≈ 4 s seguidos y se recupera soltando (jadeo audible si se agota); si la entidad ve que no contienes (no mantienes) o se agota la respiración, te encuentra → muerte normal. Si aguantas, la entidad se marcha y queda enfriamiento (≈ 20 s) antes de poder inspeccionar el mismo hueco. Sonido de respiración/latido en el audio (`audio.ts`).
- **Multijugador**: añade `hiding: boolean` y `holding: boolean` a `PlayerState` (shared + server clamp/valida; el servidor decide `inspect` y la muerte). Un hueco admite 1 jugador. Los avatares remotos escondidos se ven agachados dentro del nicho (pose existente o escala/posición simple; no hace falta animación nueva).
- **Espectador y chat** siguen funcionando; un jugador escondido sigue pudiendo escribir en chat.
- UI en inglés: avisos de interacción con el mismo estilo que el resto del HUD (`hint`).

## Verificación (antes de informar)
1. `npm run typecheck` / `npm run build -w client` limpios.
2. Script de 200 semillas (ver arriba) con los números.
3. Navegador (panel visible): capturas del mapa nuevo (salas grandes, pasillos, un hueco), esconderse y salir, inspección de una entidad con y sin contener la respiración (puedes forzar la situación desde la consola con `__game`), y una partida con dos pestañas donde uno se esconde y el otro lo ve.
4. fps/tiempo de carga comparables a antes; el solitario sigue funcionando.

## Informe final (breve)
Qué hay, números de la verificación, archivos tocados, decisiones no previstas, lo que falte.

## Fuera de alcance
Niveles nuevos (poolrooms…), cuentas, cosméticos, lobby.
