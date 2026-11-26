// One player is "active" at a time: it owns the background-playback notification and reacts to its buttons.
import { Background } from './native';

interface Active { id: number; toggle: () => void; stop: () => void }
let active: Active | null = null;
let nextId = 1;
let stopTimer: number | undefined;

export function newPlayerId() {
  return nextId++;
}

export function playing(a: Active, title: string) {
  if (active && active.id !== a.id) active.stop();
  active = a;
  clearTimeout(stopTimer);
  Background.update({ title, playing: true });
}

export function paused(id: number, title: string) {
  if (active?.id !== id) return;
  Background.update({ title, playing: false });
  // keep the service a little while so the notification's play button still works
  clearTimeout(stopTimer);
  stopTimer = window.setTimeout(() => Background.stop(), 10 * 60 * 1000);
}

export function released(id: number) {
  if (active?.id !== id) return;
  active = null;
  Background.stop();
}

export function handleRemote(action: string) {
  if (!active) return;
  if (action === 'toggle' || action === 'play' || action === 'pause') active.toggle();
  if (action === 'stop') active.stop();
}
