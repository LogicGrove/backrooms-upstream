/** La pantalla de después de la partida (la de siempre): NOCLIP si se sale, EJECTED si no, y una sola opción. */
export default function End({ win, label = 'INSERT TAPE', onInsert }: { win: boolean; label?: string; onInsert: () => void }) {
  return (
    <div className="br" data-screen="off">
      <nav className="br-menu" aria-label="Backrooms">
        <h1 className="br-menu__title">{win ? 'NOCLIP' : 'EJECTED'}</h1>
        <p className="br-menu__sub">{win ? 'YOU GOT OUT. THIS TIME.' : 'THE TAPE IS OUT OF THE DECK'}</p>
        <ul>
          <li>
            <button type="button" className="br-opt" autoFocus onClick={onInsert}>
              {label}
            </button>
          </li>
        </ul>
      </nav>
    </div>
  );
}
