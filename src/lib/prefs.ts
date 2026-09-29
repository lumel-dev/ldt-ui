/**
 * Preferencias de la persona que usa la UI: carpeta de trabajo, favoritos, uso reciente.
 * No son de `ldt` (un agente no tiene favoritos), por eso viven aca y no alla.
 *
 * localStorage puede no estar (modo privado, storage bloqueado): todo va con try/catch y
 * la UI funciona igual sin recordar nada.
 */

const KEY = 'ldt-ui:prefs'

export interface Prefs {
  root: string
  favorites: string[]
  /** Abrir el navegador cuando un server levantado desde la UI queda listo. */
  autoOpen: boolean
  recent: Record<string, number>
}

// autoOpen arranca apagado: que aparezcan pestanas solas sorprende si no se pidio.
const EMPTY: Prefs = { root: '', favorites: [], recent: {}, autoOpen: false }

export function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? { ...EMPTY, ...JSON.parse(raw) } : EMPTY
  } catch {
    return EMPTY
  }
}

export function savePrefs(prefs: Prefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs))
  } catch {
    // sin storage: se pierde al recargar, nada mas
  }
}
