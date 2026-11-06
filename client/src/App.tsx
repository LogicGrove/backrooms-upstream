import { useState } from 'react';
import Backrooms from './game/Backrooms';
import End from './game/End';

/** La web: la cinta puesta desde el principio; al expulsarla o al salir por el ascensor, una pantalla para volver a meterla. */
export default function App() {
  const [run, setRun] = useState(0);
  const [end, setEnd] = useState<'eject' | 'win' | null>(null);
  if (end) return <End win={end === 'win'} onInsert={() => (setEnd(null), setRun((n) => n + 1))} />;
  return <Backrooms key={run} onQuit={() => setEnd('eject')} onWin={() => setEnd('win')} />;
}
