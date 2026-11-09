# Revision de la nueva base

Base del autor 3ad9198, 8 de noviembre de 2026. La revision parte de esta version con misiones, economia y Poolrooms.

Cambios comprobados con regresiones. Ataques y visibilidad respetan paredes/esquinas. Movimiento e inspeccion evitan fosos y muebles. BFS rechaza origen bloqueado o exterior. La recolocacion de escondidos utiliza la boca transitable. Tiempos no finitos no contaminan la simulacion.

Servidor. Dificultades validadas como propiedades propias, acciones requieren equipo poseido y jugador activo, muerte contabilizada una sola vez. Recogidas con reintentos y recibos idempotentes, separados por ronda y fase y con caducidad de30s. Administracion configurada exclusivamente mediante ADMIN_UID, nunca mediante un nombre registrable.

Cliente. Pausa libera disparo y zoom. Los drops repetidos no crean mallas de municion inutilmente. Se liberan copias propias y geometria procedural al retirar objetos o cerrar escenas y se ignoran confirmaciones tras destruirlas. El render software de Windows/SwiftShader se detecta para usar presupuesto reducido, y las miniaturas se renderizan a su tamano final. Se libera tambien la escena Poolrooms al destruir el motor.

Comprobar con npm.cmd test, npm.cmd run typecheck y npm.cmd run build. Node24 y Python3. Sin dependencias nuevas. Para habilitar administrador, registrar primero la cuenta, obtener su ID y configurar ADMIN_UID con ese numero en el entorno del servidor antes de iniciarlo. Dejarlo sin configurar mantiene las cuentas con permisos normales.

Alcance. Revision dirigida a errores reproducibles de logica, autoridad y recursos. No constituye una garantia de ausencia de bugs ni una validacion completa de todas las misiones y niveles por una persona. Las acciones siguen teniendo autoridad parcial de cliente. Las pruebas de navegador usan una base separada. Las cuentas y sesiones locales quedan fuera del repositorio.

Respaldo local anterior en D:/Backrooms_Multiplayer_game/backrooms-before-upstream.bundle y bases de datos en local-private-backup. La version corregida se guarda en repositorio privado LogicGrove/backrooms. El usuario revoco expresamente el apagado del PC.

Verificacion final: 29/29 regresiones, types de cliente/servidor y build. Prueba real de navegador headless a1280x720 entra en partida individual con mision, sin errores de carga ni aplicacion (unos57FPS sobre RTX2060 en esta ejecucion). Integracion de red con dos clientes Socket.IO cubre votacion/carga, recogidas repetidas y disparos bloqueados por pared. Evidencia local en D:/Temp/backrooms-upstream-check. No se completo una ronda humana ni se verificaron exhaustivamente Poolrooms/hospital en navegador. El build conserva el aviso upstream de bundle principal mayor de1500kB.
