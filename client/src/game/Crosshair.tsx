/** El punto de mira: un punto claro de 4 px con un contorno oscuro. `fixed` lo centra en la pantalla (el HUD); sin él va en línea (la vista previa de SETTINGS). */
export function Crosshair({ fixed = false }: { fixed?: boolean }) {
  return <i className="br-cross" data-fixed={fixed || undefined} aria-hidden="true" />;
}
