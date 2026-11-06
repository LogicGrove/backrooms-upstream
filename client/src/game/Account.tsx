import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ACHIEVEMENTS, PASS_MAX, PASS_MIN, USER_RE } from '@backrooms/shared';
import { ApiError, type Account } from '../account';

/*
 * Cuentas en el OSD de la cinta: inicio de sesión, registro (con el código de recuperación, que sale una sola vez),
 * restablecer la contraseña y la lista de logros. Mismo lenguaje que el resto: texto sobre la imagen, sin cajas.
 */

export type AuthMode = 'signin' | 'register' | 'recover';

/** Lo que dice un fallo, en el tono del OSD. */
const say = (e: unknown) => (e instanceof ApiError ? (e.status === 0 ? 'SERVER NOT REACHABLE · PLAY AS GUEST' : e.message) : 'SOMETHING WENT WRONG').toUpperCase();

/** El código de recuperación, una sola vez: copiar y «I saved it» antes de seguir. */
function Codes({ code, title, onDone }: { code: string; title: string; onDone: () => void }) {
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const box = useRef<HTMLParagraphElement>(null);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch {
      // sin portapapeles (http o permisos): se deja seleccionado para copiarlo a mano
      const s = getSelection(), r = document.createRange();
      if (box.current && s) (r.selectNodeContents(box.current), s.removeAllRanges(), s.addRange(r));
    }
  };
  return (
    <div className="br-dialog br-auth" role="dialog" aria-modal="true" aria-labelledby="br-auth-t">
      <p className="br-lobby__head" id="br-auth-t">{title}</p>
      <p>YOUR RECOVERY CODE. IT IS SHOWN ONLY ONCE.</p>
      <p className="br-lobby__dim">THERE IS NO EMAIL: THIS CODE IS THE ONLY WAY TO RESET YOUR PASSWORD IF YOU FORGET IT. WRITE IT DOWN OR KEEP IT IN A PASSWORD MANAGER.</p>
      <p className="br-code" ref={box} aria-label={`Recovery code ${code.replace(/-/g, ' ')}`}>
        {code}
      </p>
      <ul className="br-lobby__opts">
        <li>
          <button type="button" className="br-opt" onClick={copy} autoFocus>
            {copied ? 'COPIED' : 'COPY CODE'}
          </button>
        </li>
        <li>
          <button type="button" className="br-opt br-check" role="checkbox" aria-checked={saved} onClick={() => setSaved(!saved)}>
            [{saved ? 'X' : ' '}] I SAVED IT
          </button>
        </li>
        <li>
          <button type="button" className="br-opt" disabled={!saved} onClick={onDone}>
            CONTINUE
          </button>
        </li>
      </ul>
    </div>
  );
}

export function AuthScreen({ acct, mode: first, onClose }: { acct: Account; mode: AuthMode; onClose: () => void }) {
  const [mode, setMode] = useState<AuthMode>(first);
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [again, setAgain] = useState('');
  const [rcode, setRcode] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState<{ code: string; title: string; next: 'close' | 'signin' } | null>(null);
  const alive = useRef(true);
  useEffect(() => () => void (alive.current = false), []);
  // Escape vuelve (no mientras se enseña el código: hay que guardarlo)
  useEffect(() => {
    if (shown) return;
    const key = (e: KeyboardEvent) => e.key === 'Escape' && (e.preventDefault(), onClose());
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  }, [shown, onClose]);

  const go = (m: AuthMode) => (setMode(m), setErr(''), setPass(''), setAgain(''), setRcode(''));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    // lo evidente se dice aquí; el servidor lo vuelve a comprobar todo
    const bad =
      mode !== 'signin' && !USER_RE.test(user) ? 'USERNAME: 3-16 LETTERS, NUMBERS OR _'
      : mode !== 'signin' && (pass.length < PASS_MIN || pass.length > PASS_MAX) ? `PASSWORD: ${PASS_MIN}-${PASS_MAX} CHARACTERS`
      : mode !== 'signin' && pass !== again ? 'PASSWORDS DO NOT MATCH'
      : mode === 'recover' && rcode.replace(/[^A-Za-z0-9]/g, '').length !== 20 ? 'RECOVERY CODE: 20 CHARACTERS'
      : !user || !pass ? 'ENTER YOUR USERNAME AND PASSWORD'
      : '';
    if (bad) return setErr(bad);
    setErr('');
    setBusy(true);
    try {
      if (mode === 'signin') {
        await acct.login(user, pass);
        if (alive.current) onClose();
      } else if (mode === 'register') {
        const c = await acct.register(user, pass);
        if (alive.current) setShown({ code: c, title: 'ACCOUNT CREATED', next: 'close' });
      } else {
        const c = await acct.recover(user, rcode, pass);
        if (alive.current) setShown({ code: c, title: 'PASSWORD RESET', next: 'signin' });
      }
    } catch (x) {
      if (alive.current) setErr(say(x));
    } finally {
      if (alive.current) (setBusy(false), setPass(''), setAgain(''));
    }
  };

  if (shown) return <Codes code={shown.code} title={shown.title} onDone={() => (shown.next === 'close' ? onClose() : (setShown(null), go('signin')))} />;
  const head = mode === 'signin' ? 'SIGN IN' : mode === 'register' ? 'REGISTER' : 'RESET PASSWORD';
  return (
    <form className="br-dialog br-auth" role="dialog" aria-modal="true" aria-labelledby="br-auth-t" onSubmit={submit} noValidate>
      <p className="br-lobby__head" id="br-auth-t">{head}</p>
      <p className="br-lobby__dim">
        {mode === 'register' ? 'NO EMAIL NEEDED. YOUR PROGRESS AND WARDROBE ARE SAVED ON THE SERVER.' : mode === 'recover' ? 'ENTER THE RECOVERY CODE YOU GOT WHEN YOU REGISTERED.' : 'TO KEEP YOUR ACHIEVEMENTS AND YOUR LOOK.'}
      </p>
      {err && (
        <p className="br-lobby__err" role="alert">
          {err}
        </p>
      )}
      <label className="br-lobby__row">
        USERNAME
        <input className="br-field br-field--cred" value={user} maxLength={16} autoComplete="username" autoCapitalize="off" spellCheck={false} autoFocus onChange={(e) => setUser(e.target.value)} />
      </label>
      {mode === 'recover' && (
        <label className="br-lobby__row">
          RECOVERY CODE
          <input className="br-field br-field--cred br-field--wide" value={rcode} maxLength={30} autoComplete="off" autoCapitalize="characters" spellCheck={false} placeholder="XXXXX-XXXXX-XXXXX-XXXXX" onChange={(e) => setRcode(e.target.value)} />
        </label>
      )}
      <label className="br-lobby__row">
        {mode === 'recover' ? 'NEW PASSWORD' : 'PASSWORD'}
        <input className="br-field br-field--cred" type="password" value={pass} maxLength={PASS_MAX} autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} onChange={(e) => setPass(e.target.value)} />
      </label>
      {mode !== 'signin' && (
        <label className="br-lobby__row">
          REPEAT
          <input className="br-field br-field--cred" type="password" value={again} maxLength={PASS_MAX} autoComplete="new-password" onChange={(e) => setAgain(e.target.value)} />
        </label>
      )}
      <ul className="br-lobby__opts">
        <li>
          <button type="submit" className="br-opt" disabled={busy}>
            {busy ? 'WORKING…' : mode === 'signin' ? 'SIGN IN' : mode === 'register' ? 'CREATE ACCOUNT' : 'RESET PASSWORD'}
          </button>
        </li>
        {mode === 'signin' && (
          <>
            <li>
              <button type="button" className="br-opt" onClick={() => go('register')}>NO ACCOUNT? REGISTER</button>
            </li>
            <li>
              <button type="button" className="br-opt" onClick={() => go('recover')}>FORGOT PASSWORD</button>
            </li>
          </>
        )}
        {mode !== 'signin' && (
          <li>
            <button type="button" className="br-opt" onClick={() => go('signin')}>HAVE AN ACCOUNT? SIGN IN</button>
          </li>
        )}
        <li>
          <button type="button" className="br-opt" onClick={onClose}>BACK</button>
        </li>
      </ul>
      <p className="br-lobby__dim br-lobby__keys">{mode === 'register' ? 'USERNAME 3-16: LETTERS, NUMBERS, _ · ' : ''}ENTER SUBMIT · ESC BACK</p>
    </form>
  );
}

export { AchievementsScreen } from './Achievements';

/** El popup de la cuenta (desde la cajita de la pantalla de título): quién eres y entrar, registrarse o salir. */
export function AccountMenu({ acct, onAuth, onClose }: { acct: Account; onAuth: (m: AuthMode) => void; onClose: () => void }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && (e.preventDefault(), onClose());
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  }, [onClose]);
  const user = acct.me?.username;
  return (
    <div className="br-dialog br-dialog--acct" role="dialog" aria-modal="true" aria-labelledby="br-acct-t">
      <div className="br-acctbox br-acctbox--static">
        <span className="br-avatar" aria-hidden="true">{user ? user[0].toUpperCase() : '?'}</span>
        <span>
          <span className="br-acctbox__n" id="br-acct-t">{user ?? 'GUEST'}</span>
          <span className="br-lobby__dim">{user ? 'SIGNED IN' : 'PROGRESS IS NOT SAVED'}</span>
        </span>
      </div>
      <ul className="br-lobby__opts">
        {user ? (
          <li>
            <button type="button" className="br-opt" onClick={() => (void acct.logout(), onClose())} autoFocus>SIGN OUT</button>
          </li>
        ) : (
          <>
            <li>
              <button type="button" className="br-opt" onClick={() => onAuth('signin')} autoFocus>SIGN IN</button>
            </li>
            <li>
              <button type="button" className="br-opt" onClick={() => onAuth('register')}>REGISTER</button>
            </li>
          </>
        )}
        <li>
          <button type="button" className="br-opt" onClick={onClose}>CLOSE</button>
        </li>
      </ul>
    </div>
  );
}

/** La cajita de la esquina de la pantalla de título: un cuadrado con la inicial, el nombre y el estado. */
export function AccountBox({ acct, onClick }: { acct: Account; onClick: () => void }) {
  const user = acct.me?.username;
  return (
    <button type="button" className="br-acctbox" onClick={onClick} aria-label="Account">
      <span className="br-avatar" aria-hidden="true">{user ? user[0].toUpperCase() : '?'}</span>
      <span>
        <span className="br-acctbox__n">{acct.status === 'loading' ? '…' : user ?? 'GUEST'}</span>
        <span className="br-lobby__dim">{acct.status === 'user' ? 'SIGNED IN' : acct.status === 'offline' ? 'SERVER OFFLINE' : acct.status === 'loading' ? 'CHECKING TAPE' : 'NOT SIGNED IN'}</span>
      </span>
    </button>
  );
}

/** «ACHIEVEMENT UNLOCKED · NAME», arriba al centro, unos segundos. */
export function Toasts({ items }: { items: { id: number; key: string }[] }) {
  return (
    <div className="br-toasts" role="status" aria-live="polite">
      {items.map((t) => {
        const a = ACHIEVEMENTS.find((x) => x.key === t.key);
        return (
          <p key={t.id} className="br-toast">
            ● ACHIEVEMENT UNLOCKED · {a?.name ?? t.key.toUpperCase()}
          </p>
        );
      })}
    </div>
  );
}
