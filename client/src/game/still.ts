/*
 * La pantalla quieta. Sin compilación en paralelo (Firefox), cada programa nuevo congela la página
 * entre 0,2 y 0,35 s: compileGently solo compila mientras alguien sujete la pantalla quieta (una
 * imagen fija, un fotograma congelado, el negro entre escenas) o mientras está la pantalla de carga.
 * Quien la sujeta la suelta con la función que devuelve (soltarla dos veces no cuenta).
 */
let holds = 0;

export function holdStill() {
  holds++;
  let held = true;
  return () => {
    if (held) (held = false), holds--;
  };
}

export const isStill = () => holds > 0 || !!document.documentElement.dataset.loading;
