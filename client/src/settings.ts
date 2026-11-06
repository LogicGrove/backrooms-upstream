import { useSyncExternalStore } from 'react';

/*
 * Los ajustes del jugador: un objeto en localStorage (br-settings). `settings` se lee en vivo desde input.ts / player.ts;
 * la pantalla SETTINGS los cambia con `set`. Con cuenta se sincronizarán con el servidor (aún no).
 */

export interface Settings {
  volume: number; // 0–1, general
  sfx: number; // 0–1 (sin aplicar aún)
  ambient: number; // 0–1 (sin aplicar aún)
  sens: number; // multiplicador del ratón
  invertY: boolean;
  vhs: number; // 0–1, intensidad del efecto VHS (sin aplicar aún)
  fov: number; // grados
  fps: boolean; // mostrar FPS
  crosshair: boolean; // el punto de mira, en el centro de la imagen
  reduceMotion: boolean; // sin aplicar aún
  toggleBreath: boolean; // alternar en vez de mantener (sin aplicar aún)
}

export const DEFAULTS: Settings = { volume: 1, sfx: 1, ambient: 1, sens: 1, invertY: false, vhs: 1, fov: 70, fps: false, crosshair: true, reduceMotion: false, toggleBreath: false };

const KEY = 'br-settings';
const read = (): Settings => {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    return { ...DEFAULTS };
  }
};

/** Los valores de ahora; los lee el juego cada vez que los necesita. */
export let settings: Settings = read();
const subs = new Set<() => void>();
const listeners: Partial<{ [K in keyof Settings]: (v: Settings[K]) => void }> = {};

/** Para quien tiene que reaccionar a un cambio (el volumen del audio). */
export const onSetting = <K extends keyof Settings>(k: K, f: (v: Settings[K]) => void) => void (listeners[k] = f as never);

export function setSetting<K extends keyof Settings>(k: K, v: Settings[K]) {
  settings = { ...settings, [k]: v };
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {}
  listeners[k]?.(v);
  subs.forEach((f) => f());
}

export const resetSettings = () => Object.entries(DEFAULTS).forEach(([k, v]) => setSetting(k as keyof Settings, v as never));

export const useSettings = () =>
  useSyncExternalStore(
    (f) => (subs.add(f), () => void subs.delete(f)),
    () => settings,
  );
