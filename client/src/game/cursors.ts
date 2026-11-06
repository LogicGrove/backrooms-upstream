import { ARROW, HOURGLASS } from '../pixels';

/*
 * Los cursores de los 90, en blanco y negro como los de Windows 95: la flecha, el reloj de arena
 * mientras carga y la mano sobre lo que se pulsa. Cursores CSS de verdad (a doble tamaño, píxeles sin
 * suavizar), no un dibujo que persigue al ratón.
 */

// 3 contorno negro · 4 relleno blanco
const HAND = [
  '....33..........',
  '...3443.........',
  '...3443.........',
  '...3443.........',
  '...3443333......',
  '...34434434333..',
  '.3334434434343..',
  '34434444444443..',
  '34444444444443..',
  '.3444444444443..',
  '..344444444443..',
  '..34444444443...',
  '...3444444443...',
  '...3444444443...',
  '....33333333....',
];

function css(grid: readonly string[], hx: number, hy: number) {
  const k = 2, cv = document.createElement('canvas');
  cv.width = grid[0].length * k;
  cv.height = grid.length * k;
  const x = cv.getContext('2d')!;
  grid.forEach((r, y) => [...r].forEach((ch, i) => ch !== '.' && ((x.fillStyle = ch === '3' ? '#000' : '#fff'), x.fillRect(i * k, y * k, k, k))));
  return `url(${cv.toDataURL()}) ${hx * k} ${hy * k}, auto`;
}

/** Pone los tres cursores como variables CSS en `el` (--br-arrow, --br-wait, --br-hand). */
export function setCursors(el: HTMLElement) {
  el.style.setProperty('--br-arrow', css(ARROW, 0, 0));
  el.style.setProperty('--br-wait', css(HOURGLASS, 5, 5));
  el.style.setProperty('--br-hand', css(HAND, 4, 0));
}
