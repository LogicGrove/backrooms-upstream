# Poolrooms (nivel 2): decisiones de rendimiento

Documento previo al diseño del nivel. Solo técnica: agua, reflejos y modelos. Entidades, misiones y mapa se deciden después, paso a paso.

Punto de partida del motor: Three 0.160, pipeline propio (composer + VHS), luz horneada (lightmap), instancing, laberinto en rejilla (`CELL = 1.5 m`, `HEIGHT = 2.7 m`), mapa generado por semilla en `shared/` (cliente y servidor sacan lo mismo). Referencias: pasillos de azulejo blanco con juntas oscuras, columnas redondas, agua turquesa poco profunda, luz que entra por huecos y se queda en las paredes, escaleras de caracol, toboganes, túneles abovedados.

## 0. Principios

1. **El agua es un plano con un shader, no una simulación.** Todo lo que se ve (olas, profundidad, reflejos, cáusticas) se fabrica en el fragmento a partir de texturas pequeñas y uniforms.
2. **Una única altura de agua en todo el nivel.** Es lo que permite un solo reflejo planar compartido y un solo material. Zonas "a otra altura" (piscina elevada, tobogán) usan el reflejo barato (cubemap), nunca otro render.
3. **El agua es cosmética en el cliente; el servidor solo conoce celdas.** Profundidad y lentitud salen del mapa (`maze`) por semilla, igual que los huecos. Nada de física de fluidos en red.
4. **Calidad en tres escalones** (ajuste del jugador): ALTA (reflejo planar), MEDIA (cubemap + fresnel), BAJA (sin reflejo, solo color y cáusticas). Se elige sola si los FPS caen.
5. **Presupuesto objetivo:** 60 fps en un portátil integrado. Extra del nivel sobre Backrooms: <= 1,5 ms de GPU y <= 150 draw calls más. Se mide antes de seguir (ver sección 5).

## 1. Agua realista que se mueve con el personaje, barata

### 1.1 La superficie
- **Geometría:** un plano por trozo del mapa (no uno por celda), con frustum culling. Todo el agua del nivel comparte material: pocas draw calls.
- **Sin olas en vértices.** El relieve viene de **dos mapas de normales** que se desplazan en direcciones distintas (el truco clásico), de 256x256 sin costuras, **generados por código al cargar** (ruido). Un mapa pequeño de baja frecuencia da la ondulación grande; el otro, el brillo fino.
- **Agua opaca, no transparente.** El shader pinta el propio suelo de azulejo (misma textura que el suelo real, con la UV desplazada por la normal = refracción falsa) y lo tiñe según la profundidad (absorción tipo Beer-Lambert: más verde-turquesa cuanto más hondo, como en las referencias). Así **no hay transparencia ni orden de dibujado ni render target de refracción.** Las celdas inundadas no dibujan su suelo normal.
- **Orilla:** un valor de profundidad por vértice (0 en el borde, 1 en el fondo) da espuma/aclarado en el borde y deja ver el suelo seco sin costura.
- **Cáusticas:** una textura procedural pequeña, dos capas que se desplazan, se suma al suelo bajo el agua y, atenuada con la altura, a las paredes y columnas cerca de la línea de flotación. Un solo muestreo extra. Es lo que da la sensación de "luz que se mueve", mucho más que unas olas de verdad.
- **Brillo de la linterna y de los paneles:** se calcula a mano en el shader del agua (un cono analítico para la linterna del jugador, brillo especular con la normal de las olas). No se añaden luces de Three (cada una encarece todos los materiales).

### 1.2 Que reaccione al personaje
- **Ondas por impulsos, no por simulación.** El shader recibe un array de **hasta 12 fuentes** (x, z, tiempo de nacimiento, intensidad). Cada una suma anillos que se expanden y se apagan: `sin(dist - v*t) * exp(-dist) * exp(-t)`. Se crea una fuente por paso del jugador (cada ~0,35 m andando, más al correr), por cada jugador remoto (con sus estados de red, que ya llegan) y por cada entidad. Cuesta unas pocas operaciones por píxel de agua, sin textura de alturas.
- **Escalón opcional si queda corto:** una textura de ondas 128x128 que se simula solo alrededor de la cámara (ecuación de ondas en ping-pong, ~0,1 ms) y se mueve con el jugador. No es necesaria de inicio.
- **Salpicaduras:** unos sprites (partículas pequeñas con un pool fijo de 64) en cada paso y caída, más un sonido distinto de pisada y un bucle de chapoteo.
- **Efecto en el juego:** vadear a media pierna: velocidad x0,75, balanceo de cámara más suave, sonido de chapoteo (las entidades lo oyen: **correr por el agua hace ruido**, útil para el diseño del nivel). Nada de nadar al principio. Si más adelante hay zonas hondas, se marcan en el mapa y bajo el nivel del agua se añade una tinta cheap de pantalla, sin otro render.

## 2. Reflejos del agua y de todo el área

Escalones, de más caro a más barato. El nivel elige uno según el ajuste de calidad.

1. **Reflejo planar (ALTA).** Una segunda cámara espejada respecto al plano del agua pinta una vez al **render target a media resolución** (o un tercio). Un solo render para todo el nivel (misma altura). El shader del agua lo muestrea con la UV **desplazada por la normal** de las olas (la distorsión es lo que lo hace parecer agua y esconde la baja resolución) y mezcla con fresnel (más reflejo a ángulo rasante, más suelo mirando hacia abajo).
   - **Qué entra en el reflejo:** una **capa** propia (`Layers`) con techo, paneles de luz, paredes, columnas y el borde de las piscinas. **Fuera:** entidades, objetos pequeños, efectos y todo el postproceso (VHS, ruido). Las entidades y los compañeros se ven reflejados de forma barata si se añaden a la capa y están cerca.
   - **Recorte:** plano de corte oblicuo en la altura del agua (para no pintar lo de bajo el agua) y distancia de dibujo recortada (~18 m, la niebla esconde el resto).
   - **Frecuencia:** a 30 Hz (un fotograma sí y otro no) y solo si el agua está en pantalla (se comprueba con el frustum). Estimación: +0,8–1,2 ms y menos de 100 draw calls en un mapa de este tamaño.
2. **Cubemap horneado (MEDIA).** Un `CubeCamera` de 128 px por cara en el centro de cada zona, pintado **una vez al cargar el nivel** (no por fotograma). Sirve de reflejo del agua (mucho menos exacto, pero con la distorsión de las olas pasa), de reflejo brillante en azulejos mojados y de luz ambiente de entidades y objetos. Coste por fotograma: cero.
3. **Reflejo falso por copias (BAJA / refuerzo).** El techo es plano y repetitivo, así que se **duplican en espejo** (instancing) los paneles de luz y las columnas bajo el agua con un degradado hacia el fondo. Es el truco de los juegos 2D llevado a 3D y cuesta casi nada.
4. **No se usa SSR** (reflejo en espacio de pantalla): caro, con artefactos en bordes, no encaja con el pipeline VHS.

**Reflejo en paredes y columnas:** los azulejos tienen un brillo suave horneado por zona más una banda de reflejo cerca de la línea de flotación, con el mismo desplazamiento de olas que el agua (una función compartida). No hace falta que el azulejo refleje de verdad.

**Luz:** se mantiene el horneado (lightmap) para techos, paredes y columnas; el agua no se hornea: toma de cada zona un color ambiente (atributo de vértice) y las cáusticas la animan.

## 3. Modelos 3D, texturas y sonido necesarios

La mayor parte del nivel es **procedural**, como las Backrooms: no hace falta un modelo por cosa.

### Procedural (sin modelos)
- Suelo, paredes, techo, **columnas redondas** y paredes curvas: geometría generada (cilindros y arcos con UV de azulejo).
- Agua, olas, cáusticas, salpicaduras, burbujas, pelotas flotantes (esferas): código.

### Texturas (pequeñas, con mipmaps, anisotropía 4)
- Azulejo blanco con junta oscura, 512x512 sin costuras (+ normal sencilla).
- Azulejo turquesa de piscina y variante agrietada (las grietas de la referencia 2 como decal).
- Decals de pintadas (los ojos de "all eyes on me") hechos con lienzo o dibujados aparte.
- Mapas de normales del agua, cáusticas y ruido: **procedurales al cargar**.

### Modelos (por orden de utilidad). Ya los tienes en `assets-src/`
- `water_slide_spiral_5_turn.zip` y `backrooms_spiral.zip`: escalera y tobogán de caracol (referencias 3 y 5).
- `wather_backrooms.zip`, `helium_balloon.zip`, `balloon_arch.zip`: ambiente y juguetes de piscina.
- `worn_overlead_light.zip`: paneles del techo (el de la referencia 5).

### Modelos nuevos que pediría (todos con licencia CC-BY o libre, < 20k triángulos cada uno)
1. **Escalera de piscina / pasamanos de acero** (cromado) y escalones empotrados.
2. **Tobogán recto abovedado** (rosa, como la referencia 5), si no basta con el de caracol.
3. **Rejilla de desagüe y bocas de ventilación** en pared (pequeñas, muchas copias).
4. **Boya y cuerda de calle** (flotadores de carril), **flotadores/churros de piscina**.
5. **Vestuario:** bancos, taquillas (ya hay `hospital/locker`), duchas con tubo y cabezal.
6. **Señales** ("NO RUNNING", "DEEP END") y una **silla de socorrista**.
7. **Puertas dobles metálicas** (tienes la de hospital/salida) y un **trampolín**.
8. **Foco subacuático** (disco emisivo) para las piscinas de noche.

### Sonido (audio.ts)
- Chapoteo al pisar (3–4 variantes) y bucle de vadeo; goteo; zumbido de motor/filtro.
- **Reverb corta de sala grande** (un `ConvolverNode` o un par de retardos con realimentación) compartida: da el "eco de piscina" sin coste notable.

### Animaciones (más adelante)
- Cuerpo: andar en agua (el andar actual a menor velocidad basta de inicio), caída al agua, salir del agua.
- Entidades del nivel: se deciden con ellas (nadar, emerger).

## 4. Datos y servidor

- El mapa del nivel añade una capa `water` por celda (profundidad 0/1/2) generada por semilla en `shared/`. El servidor la usa para: velocidad de las entidades y jugadores en agua, ruido de pasos y celdas bloqueadas.
- Los pozos del nivel 0 ya funcionan igual (`voids` en el mapa): se reutiliza el patrón.
- Misiones y entidades: pendiente de decidir; el agua da ya algo de diseño (el chapoteo delata, hay rutas lentas y rutas por seco).

## 5. Plan de implementación y medición

1. Prototipo de **solo agua** en un cuarto de prueba: shader opaco + dos normales + profundidad por color + cáusticas. Medir ms/fotograma y draw calls.
2. Añadir **ondas por impulsos** (jugador, remotos, entidades). Medir.
3. Añadir **reflejo planar** (media resolución, 30 Hz, capa propia) y comparar con el cubemap. Quedarse con el que cumpla el presupuesto.
4. Generador de mapa del nivel (columnas, pasillos curvos, piscinas, escaleras) usando la capa `water` del servidor.
5. Modelos, sonido, calidad ALTA/MEDIA/BAJA y autoajuste por FPS.
6. Entidades y misiones del nivel.

**Medición:** `renderer.info` (draw calls, triángulos), `performance.now()` por fase y una prueba con VHS activado, linterna encendida y 4 jugadores. Regla: si algo pasa de su presupuesto, se baja un escalón de calidad en vez de optimizar a ciegas.

## 6. Riesgos conocidos

- **Planar + VHS + post:** el reflejo se pinta antes del postproceso y sin él; hay que comprobar que el aspecto cuadra con el resto de la imagen.
- **Una sola altura de agua:** limita escaleras a otra planta. Se resuelve con zonas separadas por carga o con cubemap en las zonas elevadas.
- **Fuentes de ondas en red:** son cosméticas y salen de los estados que ya llegan; si un jugador remoto se teletransporta no debe lanzar una onda a través de la sala.
- **Niebla densa** del estilo del nivel 0 hace que el reflejo lejano no importe: aprovechar para recortar la distancia del render de reflejo.

## 7. Varias alturas de agua (decisión nueva)

Parte del nivel puede estar **bajo** la piscina principal (zonas sumergidas a las que hay que bucear). Esto rompe la regla de "una sola altura", así que se reformula sin perder el presupuesto:

- **Cubiertas (decks) discretas.** El nivel tiene 2 o 3 alturas de agua fijas (p. ej. superficie y sótano inundado), no un agua continua. Cada cubierta es un conjunto de trozos de mapa con su propio plano de agua.
- **Un solo reflejo planar a la vez:** el de la cubierta donde está la cámara. Las otras cubiertas visibles usan el cubemap horneado (cero coste). Solo se dibujan la cubierta actual y las adyacentes (culling por cubierta).
- **Sumergido** (cámara bajo el plano de su agua): sin reflejo planar. Efecto barato en una sola pasada: niebla azul-verdosa densa, viñeta, el filtro de paso bajo del audio (voz y pasos apagados, burbujas) y la superficie vista desde abajo como un "techo" brillante que ondula (el mismo plano dibujado por la cara trasera con fresnel; sin render extra).
- **Conexiones entre cubiertas:** celdas `dive` del mapa (escotillas, tragaderos, túneles, escaleras que bajan al agua). Lo decide la semilla en `shared/`, como los huecos del nivel 0.
- **El objeto del que hablaremos:** pendiente de definir (puede ser llave, válvula o un mecanismo que abre/vacía una cubierta). El diseño deja un hueco: una cubierta puede estar **vacía o inundada** según un estado de la ronda (el agua sube o baja cambiando la altura del plano, sin coste extra).
- **Servidor:** conoce las celdas profundas (`deep`) y la cubierta de cada jugador; el oxígeno lo lleva el servidor (ver sección 8) y el agua sigue siendo cosmética.

## 8. Objetos nuevos del nivel (diseño, sin implementar)

**Regla del usuario: por ahora no se añaden más logros.** Cuando haya más modelos se añadirán.

- **Jabón.** Objeto de misión: hay que encontrar N jabones por el mapa (modelo `cc0_-_soap_4`). Se cuentan como las cintas (reclamo por id, solo existen si la misión elegida es esa).
- **Pistola de agua** (modelo `water_gun`). Dispara un chorro corto (alcance ~6 m, cono estrecho; el servidor comprueba el impacto desde el estado del jugador).
  - **Efecto:** cada impacto aplica *mojado*: velocidad x0,5 mientras dure; con impactos seguidos (~1,2 s de chorro continuo) *parada* de ~3 s. Vale para **entidades y jugadores** (también compañeros). Un enfriamiento tras la parada evita el bloqueo permanente.
  - **Depósito:** limitado y con barra en la barra rápida (como la cinta y la linterna); se gasta al disparar.
  - **Puntos de recarga:** fuentes/bebederos repartidos por el mapa. El modelo de partida es el bebedero `birdbath_low_poly` (hay que comprobar que encaja); recarga manteniendo la tecla de uso unos 2 s.
  - **Red:** el servidor lleva el estado *mojado/parado* (en `EntitySim` y en el jugador) y el cliente solo pinta el chorro y los sonidos.
- **Traje de buzo.** Modelo por conseguir. Equipado: oxígeno máximo x2,5 y velocidad de movimiento -15%.
  - **Oxígeno:** barra en el HUD solo bajo el agua profunda (celdas `deep`/cubierta sumergida). Se gasta a ritmo constante (valor base propuesto 20 s, 50 s con el traje, a ajustar); al llegar a 0, muerte. Fuera de ahí se recupera deprisa. El servidor es la autoridad (si no, se podría hacer trampa); el cliente lo predice.
  - **Inventario:** ranura de equipo propia (como casco/espalda); no se puede tirar con el traje puesto bajo el agua.

## 9. Modelos nuevos recibidos (en `assets-src/`, aún sin empacar)

Escalera y barandilla de piscina (`cc0_-_pool_ladder_3`, `pool_railing`), silla de socorrista (`lifeguard_chair_asset`), foco ojo de pez de piscina (`luz_ojo_de_pez_para_piscina`), boya (`ocean_buoy`), ducha (`shower_high_poly`), flotadores (`swimming_pool_floaty_-_tubes`), rejilla y conducto de ventilación (`vent`, `ventilation_duct`), bebedero (`birdbath_low_poly`), jabón (`cc0_-_soap_4`), pistola de agua (`water_gun`), pizarra (`whiteboard`). Cada uno se empaca (`tools/pack_glb.py --max 512`) y se acredita en `client/public/models/CREDITS.md` cuando se use. Faltan: traje de buzo, punto de recarga específico si el bebedero no vale, escotilla/tragadero.

## 10. Decisiones de jugabilidad (nov 2026)

Objetivo: dejar el nivel jugable de punta a punta. Sin entidades por ahora: el peligro es el propio nivel (oxígeno, desmayo, rutas lentas).

- **Misión «SOAPS».** Los jabones son items `tape` (ids `t…`) que `poolMaze` reparte por semilla: unos en seco, otros en el fondo de piscinas hondas y en túneles inundados (ahí hace falta bucear). Reutilizan el reclamo por id y el contador de cintas.
- **Tanque de buceo** (`tank`, modelo «Simple Oxygen Tank», CC-BY). Se compra en la tienda y se conserva entre rondas. Equipado: aire x2,5 y velocidad -15 %. El oxígeno sigue en el cliente.
- **Pistola de agua** (`watergun`). Por ahora solo moja a **compañeros**: *mojado* (x0,5, 4 s) y, con ~1,2 s de chorro seguido, *parada* de 3 s con enfriamiento de ~6 s. El servidor lleva el estado y avisa al afectado (`wet`); el helper queda listo para entidades. Recarga en bebederos (`refills`).
- **Idea B para la pistola (sin hacer):** que el chorro **actúe sobre el nivel**: abrir/vaciar una cubierta accionando una válvula o un desagüe, y empujar jabones que floten. Daría uso a la pistola sin entidades y enlaza con el objeto de la cubierta vacía/inundada de §7.

## 11. Segunda planta y túneles sin fondo (`shared/src/pools.ts`)

El mapa pasa a **64x64 celdas** (`CELL` 1,5 m) y gana una segunda planta apilada. Todo sale de `generatePools(seed)` (puro: misma semilla, mismo mapa).

- **Capas.** La planta baja son los arrays de `PoolMap` de siempre (`kind/water/ya/yb/ceil/ramp/dir`). La alta es `PoolMap.up: PoolLayer` con los mismos arrays: suelo llano a `PY.up` (5,0 m) y techo `PY.tall` (9,2). Piscinas elevadas: `up.water` 1 a `PY.upShallow` (4,4) y 2 a `PY.upDeep` (3,5), superficie `PY.upSurf` (4,7); debajo, el techo baja a 3,0. `PY.tower` vale ya 5,0 (la torre/galería/pasarelas son parte de la planta alta).
- **Forjado.** Bajo suelo de la alta, `ceil` baja a `PY.ceil` (4,2). **Hueco** = `up.kind[i] === PK.wall` con suelo abajo (`kind[i] === PK.floor`) y `ceil[i] >= PY.tall - 0.01` (los `Float32Array` no comparan exacto con 9,2). Con `ceil` menor es macizo. Un pilar de la baja continúa arriba (`up.kind = PK.column`).
- **Escaleras.** Son rampas `PR.stairs` de la baja (8 peldaños, `ya`=n*0,625 a `yb`=(n+1)*0,625, hacia `dir`); el último llega a `PY.up` y la celda siguiente tiene suelo en `up`. Las celdas de la escalera son hueco en `up`. Las de las torres y los miradores de las salas altas siguen igual. Los tubos (`tubes`) salen de la torre (planta alta) a un serpentín en la baja; la planta alta se talla como macizo a su paso.
- **Movimiento.** `poolFloorY(m, x, z, y)` (metros; `y` = pies) elige la capa con suelo más alta que no pase de `y + POOL_STEP` (1,0 m) e interpola rampas; devuelve `{ y, layer }` o `null`. `poolCellY(m, cx, cy, layer)` da la altura del centro de una celda.
- **Alcance 3D.** `m.reach[capa][i]` = celda pisable alcanzable desde el inicio (subir <= 1 m, bajar sin límite, entre plantas solo por escaleras). Lo inalcanzable es pared (baja) o macizo (alta).
- **Objetos.** `Maze.lay[i] = 1` si lo que hay en esa celda (objeto, jabón, radar...) está en la planta alta; `ItemSpot.floor` lo repite (0/1). Las celdas no se repiten entre plantas (un objeto por índice).
- **Túneles sin fondo.** `m.portals: { a, b }[]` (a veces 0–2 en mapas con pocas salas; normalmente 3–5), cada boca `{ x, y, layer }` = 2x2 celdas desde la esquina menor, dentro de una masa honda con margen (nunca zanja ni túnel `tun`). `poolPortalAt(m, x, z, y)` devuelve `{ x, z, y, layer }` de la boca pareja si se está a <= 0,8 m sobre el fondo (o 0,3 bajo él); aparece a 1,0 m sobre el fondo, con la misma posición relativa. Hay pozos de 6x6 (núcleo hondo 4x4) repartidos para tener bocas; algunas bocas están en piscinas elevadas.
- **Radar.** `PlayerState.jam` (ms de «sin señal»): el cliente pone 12000 al teletransportarse y lo baja; el servidor lo reenvía (0–20000) y no recorta el salto de posición cuando `jam` sube. El radar no detecta si `jam > 0` propio o del aliado.

## 12. Dos plantas independientes y más piezas (nov 2026)

La planta alta ya no es una copia del suelo de la baja: se genera aparte, con piezas y forma propias, y las dos solo coinciden donde interesa.

- **Planta baja** (mismo árbol de cortes de siempre) con más variedad: salas de tipo `colonnade` (columnata inundada, retícula de columnas cada 3 celdas), `lounge` (canal poco hondo de 3 celdas por el centro con dos tarimas de 0,45 m a cada lado, lejos de las bocas de pasillo, que están inundadas) y la forma **anillo** (suelo alrededor, macizo en el centro) además de rectángulo, redonda, octogonal, L y cruz. Las salas `high` (techo a 6,2 m) siguen existiendo: solo se conservan donde no hay planta alta encima.
- **Planta alta, pieza a pieza.** Cada escalera (hasta 8, 8 peldaños en seco y llano de la baja, sin aislar suelo) ancla una pieza: un rellano de 3x3 y una sala que sale de él con forma `rect`, `óvalo`, `anillo` (con atrio), `L`, `cruz`, `nave larga` (7–9 x 18–28) o `lounge` (con piscina elevada). Además van 3–6 piezas sueltas por el mapa, y cada pieza se une a la más cercana anterior por una **pasarela** recta de 3 celdas (en L; si choca con algo vetado, se prueba la otra L o se deja suelta, y lo que no se alcance lo convierte `prune` en macizo). Las piezas pueden quedar sobre una sala, sobre macizo (**no hay nada debajo**: el suelo de arriba es una losa sobre pared) o a medias.
- **Vetado arriba:** las salas altas (traen su torre y galería), el centro del cruce (radio 5,5) y las salas de techo alto con 1 celda de margen (su aire llegaría al suelo de arriba).
- **Huecos y atrios.** Hueco = `up.kind` pared con suelo abajo y `ceil` >= `PY.tall` (como antes). Salen de: el agua de una piscina bajo una pieza, el patio de una pieza anillo, atrios de 6x6 (el 25 % de las piezas de 11x11 o más) y el hueco de las escaleras. Donde la alta es macizo sobre suelo de la baja, el techo de abajo es el de su sala (sin hueco: no se ve a través).
- **Piscinas elevadas** (borde a 4,4, núcleo hondo de 4x4 a 3,5) en el 40 % de las piezas grandes y siempre en las `lounge`; debajo, el techo baja a 3,0.
- **Colisión entre plantas.** `poolFloorY` descarta la capa baja si los pies están por encima de su techo (`ceil < y`): desde una pieza de arriba no se puede pasar a una celda de la baja bajo losa (techo 4,2), solo por un hueco (techo 9,2) o por las escaleras. El alcance (`bfs3`) usa la misma regla.
- **Bebederos y luminarias de la alta** salen por pieza (uno cada dos piezas, junto a un macizo) y cada 3 celdas alcanzables. Los objetos de `poolMaze` en la alta ya no exigen estar dentro del rectángulo de una sala de abajo.
- **Validación** (script con 200 semillas + 211362830): salida, cabecera y rellano de cada escalera, cada boca de túnel (masa que toca suelo alcanzado), bebederos, luminarias, cámara, jabones, linternas, latas, tanque y pistola alcanzables caminando con `poolFloorY`; determinismo; 0 fallos. Media por mapa: ~1300 celdas de suelo arriba (~590 sobre macizo), ~860 de planta baja sin nada encima, 8 jabones, 3 pares de túneles. Casos raros: mapas con solo el cruce y 1–2 salas (pasillos que no enlazan) dejan un nivel muy pequeño (~1 % de las semillas, ya pasaba antes).

