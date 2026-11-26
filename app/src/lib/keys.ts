// German key names ("C-Dur", "fis-Moll", "B-Dur" = Bb major, "H" = B) <-> pitch classes.

const PC: Record<string, number> = {
  c: 0, cis: 1, des: 1, d: 2, dis: 3, es: 3, e: 4, eis: 5, fes: 4, f: 5, fis: 6, ges: 6, g: 7, gis: 8, as: 8,
  a: 9, ais: 10, b: 10, h: 11, his: 0, ces: 11,
};

const MAJOR = ['C', 'Des', 'D', 'Es', 'E', 'F', 'Fis', 'G', 'As', 'A', 'B', 'H'];
const MINOR = ['c', 'cis', 'd', 'es', 'e', 'f', 'fis', 'g', 'gis', 'a', 'b', 'h'];

export interface Key { pc: number; minor: boolean }

export function parseKey(name: string | undefined): Key | null {
  if (!name) return null;
  const m = name.trim().match(/^([A-Ha-h](?:is|es|s)?)[\s-]*(dur|moll)?/i);
  if (!m) return null;
  const root = m[1].toLowerCase();
  const pc = PC[root];
  if (pc === undefined) return null;
  const minor = m[2] ? m[2].toLowerCase() === 'moll' : m[1][0] === m[1][0].toLowerCase();
  return { pc, minor };
}

export function keyName(k: Key): string {
  return k.minor ? `${MINOR[k.pc]}-Moll` : `${MAJOR[k.pc]}-Dur`;
}

export function transposeKey(name: string | undefined, semitones: number): string | null {
  const k = parseKey(name);
  if (!k) return null;
  return keyName({ pc: (((k.pc + semitones) % 12) + 12) % 12, minor: k.minor });
}

/** MusicXML <key><fifths>/<mode> -> German name. */
export function keyFromFifths(fifths: number, mode: string | null): string {
  const minor = mode === 'minor';
  const pc = (((fifths * 7 + (minor ? 9 : 0)) % 12) + 12) % 12;
  return keyName({ pc, minor });
}
