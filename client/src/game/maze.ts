// El mapa vive en shared/ (el servidor lo genera con la misma semilla); aquí se reexporta para no cambiar imports.
export { CELL, bfs, routeLength, generateMaze } from '@backrooms/shared';
export type { Cell, Maze, PropKind } from '@backrooms/shared';
