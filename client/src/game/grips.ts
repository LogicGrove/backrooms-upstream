import raw from './grips.json';

/*
 * Cómo se agarra cada objeto: dónde va la muñeca de cada mano, cómo se orienta la mano y cuánto se cierra
 * cada dedo, y dónde va el objeto respecto a la vista. Son datos (grips.json), no código: la herramienta de
 * desarrollo (dev/GripTool.tsx, abrir con ?grips) los retoca viendo el resultado y los guarda.
 */

export type V3 = [number, number, number];
export interface Hand {
  /** La muñeca, en el espacio del objeto (metros). */
  pos: V3;
  /** La orientación de la mano respecto al objeto (grados, XYZ). */
  rot: V3;
  /** Cuánto se cierra cada dedo (radianes): pulgar, índice, corazón, anular, meñique. */
  curl: [number, number, number, number, number];
  /** Cuánto se abre el pulgar hacia fuera (radianes). */
  spread: number;
  /** Hacia dónde apunta el codo: un desplazamiento desde el hombro, en el espacio de la vista. */
  pole: V3;
}
export interface View {
  /** Dónde va el objeto respecto a la vista y cómo se gira (grados). */
  pos: V3;
  rot: V3;
  /** Solo la camcorder: dónde va al mirar por ella (pegada al ojo). */
  aim?: V3;
}
export interface GearGrips {
  view: View;
  left?: Hand;
  right?: Hand;
}
export type GripSet = Record<'flashlight' | 'camera' | 'gun', GearGrips>;

/** Lo guardado en grips.json; `grips` es la copia viva (la herramienta la modifica y el jugador la lee cada fotograma). */
export const DEFAULT_GRIPS = raw as unknown as GripSet;
export const grips: GripSet = structuredClone(DEFAULT_GRIPS);
