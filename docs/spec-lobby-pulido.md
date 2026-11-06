# Spec — Sala de espera: más detalle, entrada cinematográfica, presencia y pantalla del ordenador

Contexto: la sala de espera 3D ya existe (`client/src/game/waiting.ts`, `Computer.tsx`, `RoomSettings.tsx`; spec original en `docs/spec-fase2-sala-de-espera.md`). Hay puerta, botón industrial, ordenador, sillón, avatares remotos, chat y la secuencia `starting` (`START_DELAY` en `shared/src/index.ts`). Quiero mejorarla en cuatro frentes.

## Reglas (obligatorias)
- Solución más simple que funcione (ponytail). Sin tests; verifica con scripts desechables y con el navegador (panel visible; si no, el lienzo mide 0 y la carga falla).
- No commits. No toques `E:\s7lver2`, `grips.json`, ni `shared/src/maze.ts`, `sim.ts`, `world.ts`, `pit.ts`, `lightmap.ts` ni `player.ts` (otro subagente trabaja el mapa y los escondites); si necesitas `game.ts`, `Backrooms.tsx`, `backrooms.css`, `shared/src/index.ts` o `server/src/index.ts`, cambios mínimos y localizados.
- Todo texto de UI en **inglés**. Estética OSD de camcorder de los 90 (sin cajas redondeadas, píldoras, glows ni degradados morado-azul).
- `npm run typecheck` y `npm run build -w client` limpios. Peso: los assets nuevos pequeños (< 1,5 MB cada uno; texturas ≤ 512 px); preferible procedural/canvas. Libera todo al salir de la sala. Respeta `prefers-reduced-motion`.

## 1. Más detalle en la sala
- Dale vida y suciedad, sin saturarla: pósters y avisos (texturas de canvas con texto/diagramas de «seguridad», ej. «EXIT ROUTE», «DO NOT PROP DOOR», una tabla de turnos), una máquina expendedora procedural con luz propia, cables por el techo y la pared, tuberías, manchas de humedad y desgaste en suelo/paredes (decals o texturas de canvas), un cubo/papelera, tablones en el suelo, un extintor, una pizarra con garabatos, una moqueta o un tramo de suelo distinto.
- Iluminación más cuidada: el fluorescente actual + un segundo con parpadeo distinto, brillo de la máquina, la luz que se cuela por debajo de la puerta, polvo flotando en los haces (`THREE.Points`), una pequeña luz de aviso en el botón. Si hace falta, un mapa de luz horneado simple o gradientes emisivos; evita añadir muchas luces reales.
- Mantén el mismo tono sucio-amarillento y el pipeline de render del juego.

## 2. Entrada más cinematográfica (fase `starting`)
- Alarga `START_DELAY` a ≈ 7500 ms (en `shared`) y rehaz la secuencia: el botón se hunde, las luces parpadean y se van una a una, un zumbido/alarma grave, la puerta se abre con un chirrido y un golpe de luz cálida con niebla y haces de polvo; la cámara (en mano) se acerca despacio, hay un breve **plano de recorrido** (travelling) cruzando el umbral hacia un pasillo largo de las Backrooms con perspectiva exagerada, una **silueta lejana** que cruza el fondo, y fundido a negro con el zumbido subiendo antes de empezar la partida.
- El pasillo detrás de la puerta debe parecer mucho más real que un plano amarillo: geometría simple con paneles de luz repetidos, niebla, ruido, y el corte a la partida debe quedar disimulado.
- Sincronizado entre clientes (arrancan con la fase `starting`); cada cliente reproduce su cámara aunque otro jugador esté lejos. Los avatares de los demás se ven (o se difuminan) mientras se cruza.
- Sonido: reutiliza `audio.ts` (osciladores/ruido); añade lo necesario (alarma, chirrido, golpe grave).
- Reduced-motion: versión corta sin balanceo.

## 3. Moverse y sentirse en la sala
- **Sombras**: sombra falsa (blob) bajo cada jugador y bajo los muebles; o sombras reales solo de los avatares si son baratas.
- **Pasos**: sonido de pasos del jugador y de los demás (con volumen/pan por distancia), reutilizando el sistema de pasos del juego.
- **Emotes**: teclas `1`–`4` (saludar, señalar, aplaudir, sentarse/agacharse…) usando clips de animación que ya tenga el rig `hazmat` (revisa los clips disponibles en el `.glb`; si falta alguno, usa una pose procedural simple). Se sincronizan por red (añade un campo opcional `emote` a `PlayerState` y a lo que valida el servidor; el servidor solo lo reparte). Etiqueta de ayuda discreta («1-4 EMOTES»).
- **Más interacción**: puedes pulsar `E` en la máquina expendedora (suena y sale una lata que cae, sin efecto), sentarte en el sillón (vista baja, quieto, `E` para levantarte) y encender/apagar el fluorescente de una lámpara de pie. Todo con avisos de interacción del mismo estilo que el resto.
- Colisiones con los muebles nuevos.

## 4. Pantalla del ordenador
- Rediseña el terminal CRT de `Computer.tsx`: arranque con líneas de BIOS, cursor, scanlines y ligera curvatura/viñeta con CSS, parpadeo. Pestañas `ROOM` (ajustes existentes) y `WARDROBE`.
- `WARDROBE` ya preparado visualmente (sin lógica de cuentas aún): a la izquierda una **vista previa 3D del avatar** girando (render pequeño en un canvas/ventana, reusa el rig `hazmat`, barato), a la derecha casillas `COLOR`, `HEAD`, `BACK` con valores de ejemplo bloqueados (candado + «LOCKED · SIGN IN») y una paleta de 6 colores de muestra que ya **cambia el tinte del avatar en la vista previa** (solo local por ahora; deja un único punto claro donde después se guardará en la cuenta). El resto, deshabilitado y con aspecto cuidado.
- Navegable con ratón y teclado (Tab, flechas, Intro, Esc para salir).

## Verificación (antes de informar)
1. `npm run typecheck` y `npm run build -w client` limpios; lista de pesos de assets nuevos.
2. Navegador (panel visible) con dos pestañas: capturas de la sala (varios ángulos), de la pantalla del ordenador (ROOM y WARDROBE), de varios instantes de la secuencia de entrada; emotes visibles en la otra pestaña; sonidos sin errores en consola.
3. Script con `socket.io-client`: `starting` dura `START_DELAY`, `emote` se reparte y se limita (valores permitidos, 1 cambio cada 200 ms).
4. fps de la sala de espera comparable a antes (indica números).

## Informe final (breve)
Qué hay, archivos tocados, pesos, decisiones no previstas, lo que falte.

## Fuera de alcance
Cuentas reales, guardar cosméticos, niveles nuevos, mapa.
