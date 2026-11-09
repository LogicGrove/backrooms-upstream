interface PickupSocket {
  timeout(ms: number): {
    emitWithAck(event: 'pickup', id: string): Promise<boolean>;
  };
}

/** Reintenta un ACK perdido con el mismo id. El servidor conserva el recibo para evitar una segunda recogida. */
export async function claimPickup(socket: PickupSocket, id: string, done: (ok: boolean) => void, timeoutMs = 2500): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    let ok: boolean;
    try {
      ok = await socket.timeout(timeoutMs).emitWithAck('pickup', id);
    } catch {
      continue;
    }
    // Un rechazo del servidor es definitivo. Solo se reintentan errores de transporte y timeouts.
    done(ok === true);
    return;
  }
  done(false);
}
