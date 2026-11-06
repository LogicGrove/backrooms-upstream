# Backrooms — documento de diseño

Estado: decisiones tomadas con el usuario; lo no decidido está en "Abiertas". Ideas sueltas en `ROADMAP.md`.

## Decisiones

| Tema | Decisión |
|---|---|
| Arquitectura | Servidor autoritativo Node + Socket.IO (monorepo: `client`, `server`, `shared`) |
| Hosting | Cliente en Vercel. Servidor: empezar en Render; destino 24/7 gratis = Oracle Always Free o Cloudflare Durable Objects (el servidor es Node plano, migrar no toca el juego) |
| Cuentas | Usuario + contraseña, sin email. argon2id, sesión por cookie httpOnly. Sin recuperación: código de recuperación mostrado una vez al registrarse |
| Co-op | Objetivo común (cintas/salida), inventario y fotos individuales. Anotado para más adelante: **modo todo compartido** (inventario, cintas y progreso comunes) |
| Muerte | Espectador por la cámara de un compañero vivo; si mueren todos, fin de partida |
| Cosméticos | Colores del personaje y accesorios, desbloqueados por logros |
| Escala v1 | 4 jugadores por sala; solo nivel Backrooms hasta cerrar el multijugador |
| Portfolio | Congelado, no se toca |

## Orden de construcción

Cada fase termina en algo jugable. Un commit por fase terminada.

### Fase 1 — Salas y multijugador básico
1. Servidor: salas públicas/privadas (código de 4–6 letras), propietario, máx. 4, lista de salas públicas.
2. Semilla compartida: el servidor da la semilla del mapa; todos generan el mismo laberinto.
3. Avatares remotos: posición/giro/animación a 15 Hz con interpolación; linterna y objeto en mano visibles.
4. Entidades: el servidor decide dónde están y a quién persiguen; los clientes solo las pintan.
5. Objetos y cintas compartidos: recoger un objeto lo quita para todos.
6. Muerte → espectador; fin de partida si mueren todos o alguien sale.
7. Chat de texto (sala), con límite de ritmo y longitud.

### Fase 2 — Sala de espera
1. Escena pequeña (habitación de baldosas, ordenador, puerta cerrada).
2. Los jugadores se ven y hablan en el chat.
3. Botón del propietario → la puerta se abre a las Backrooms, animación de cámara cruzándola, todos aparecen allí.
4. El ordenador abre la pantalla de personalización (se rellena en la fase 3).

### Fase 3 — Cuentas, logros, armario
1. Registro/login, hash argon2id, cookie de sesión, límite de intentos, código de recuperación.
2. Base de datos: SQLite en el servidor para empezar (usuarios, logros, cosméticos); mover a Postgres gratuito si el hosting lo exige.
3. Logros en el servidor (hoy están en localStorage; se migran al iniciar sesión).
4. Cosméticos: tinte de ropa/piel y accesorios sobre huesos del rig; se eligen en el ordenador de la sala y se ven en multijugador.
5. Pantalla principal rehecha: login, armario, lista de salas.

### Fase 4 — Más mundo
1. Niveles nuevos (Poolrooms, etc.) manteniendo la generación procedural, más grandes y con más variedad.
2. Objetivo de exploración y nivel final.
3. Modo "todo compartido" como variante de sala.

## Notas técnicas
- Anti-trampas básicas: el servidor valida recogidas, daño y llegada a la salida.
- La semilla común mantiene el tráfico bajo: se envían estados, no el mapa.
- Contraseñas: nunca reversibles; `argon2id` con parámetros recomendados, nada de cifrado simétrico.
- Render gratis se duerme; el cliente debe mostrar "despertando servidor" en el primer intento.

## Abiertas
- Voz o solo texto (ahora solo texto).
- Moderación del chat y de nombres de usuario.
- Cuántos y cuáles logros desbloquean cada cosmético.
- Base de datos definitiva según el hosting final.
