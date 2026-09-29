import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { belongs, ldt, type DevProc, type PortOwner, type Project } from '@/lib/ldt'
import { loadPrefs, savePrefs, type Prefs } from '@/lib/prefs'

export type Status =
  | { kind: 'running'; proc: DevProc }
  | { kind: 'starting'; proc: DevProc }
  | { kind: 'crashed'; proc: DevProc }
  | { kind: 'port-taken'; owner: PortOwner; by: string | null }
  | { kind: 'idle' }

export interface ProjectView extends Project {
  status: Status
  favorite: boolean
  lastUsed: number
  pending: 'start' | 'stop' | null
}

function statusOf(project: Project, procs: DevProc[]): Status {
  const mine = procs.filter((p) => belongs(p.cwd, project.root))
  const proc = mine.find((p) => p.ready) ?? mine.find((p) => p.alive) ?? mine[0]
  if (proc?.ready) return { kind: 'running', proc }
  if (proc?.alive) return { kind: 'starting', proc }
  if (proc) return { kind: 'crashed', proc }
  const owner = project.port_owner
  if (!owner) return { kind: 'idle' }
  // `port_owner` es una foto del ultimo scan; los procesos se miran en vivo. Si el pid es
  // de un server de ldt que sigue corriendo se lo nombra; si era de ldt y ya no esta,
  // la foto quedo vieja (se paro despues del scan) y el puerto esta libre.
  const holder = procs.find((p) => owner.pid !== null && (p.pid === owner.pid || p.port_pid === owner.pid))
  if (holder) return { kind: 'port-taken', owner, by: holder.name }
  if (owner.ldt) return { kind: 'idle' }
  return { kind: 'port-taken', owner, by: null }
}

// El scan cuesta un par de segundos (git en cada repo) y lo que cambia (puertos ajenos,
// ramas) cambia poco: cada 30s alcanza. `dev list` es barato y es lo que se mira de cerca.
const SCAN_EVERY = 30_000
const LIST_FAST = 1_000
const LIST_SLOW = 4_000

export function useWorkspace() {
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs)
  const [projects, setProjects] = useState<Project[]>([])
  const [procs, setProcs] = useState<DevProc[]>([])
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<Record<string, 'start' | 'stop'>>({})
  // Proyectos que se levantaron desde la UI y todavia no quedaron listos. Al quedar listos
  // se reescanea (el puerto recien ahora esta tomado) y, si se pidio, se abre el navegador.
  const startedHere = useRef(new Set<string>())

  const updatePrefs = useCallback((fn: (p: Prefs) => Prefs) => {
    setPrefs((prev) => {
      const next = fn(prev)
      savePrefs(next)
      return next
    })
  }, [])

  const scan = useCallback(async () => {
    if (!prefs.root) return
    setScanning(true)
    try {
      const res = await ldt.scan(prefs.root)
      setProjects(res.projects)
      setProcs(res.projects.flatMap((p) => p.dev))
      setError(null)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setScanning(false)
    }
  }, [prefs.root])

  const refreshProcs = useCallback(async () => {
    try {
      setProcs(await ldt.list())
    } catch {
      // Un tick fallido no merece un toast: el siguiente lo corrige.
    }
  }, [])

  useEffect(() => {
    scan()
    const id = setInterval(scan, SCAN_EVERY)
    const onFocus = () => scan()
    window.addEventListener('focus', onFocus)
    return () => {
      clearInterval(id)
      window.removeEventListener('focus', onFocus)
    }
  }, [scan])

  const busy = procs.some((p) => p.alive && !p.ready) || Object.keys(pending).length > 0
  useEffect(() => {
    const id = setInterval(refreshProcs, busy ? LIST_FAST : LIST_SLOW)
    return () => clearInterval(id)
  }, [refreshProcs, busy])

  // Seguir a los servers levantados desde aca hasta que escuchen o se caigan.
  useEffect(() => {
    for (const slug of startedHere.current) {
      const project = projects.find((p) => p.slug === slug)
      if (!project) continue
      const status = statusOf(project, procs)
      if (status.kind === 'running' && status.proc.url) {
        startedHere.current.delete(slug)
        if (prefs.autoOpen) ldt.open('url', status.proc.url).catch(() => {})
        // Recien ahora el puerto esta tomado: el resto de las tarjetas que usan el mismo
        // puerto tienen que enterarse de quien lo tiene.
        scan()
      } else if (status.kind === 'crashed') {
        startedHere.current.delete(slug)
        toast.error(`${project.name} se cayó al arrancar`, { description: 'Mirá los logs.' })
      }
    }
  }, [procs, projects, scan, prefs.autoOpen])

  const withPending = useCallback(
    async (slug: string, kind: 'start' | 'stop', fn: () => Promise<unknown>) => {
      setPending((p) => ({ ...p, [slug]: kind }))
      try {
        await fn()
        await refreshProcs()
        // Parar libera un puerto que la foto del scan todavia da por tomado.
        if (kind === 'stop') scan()
      } catch (err) {
        toast.error((err as Error).message)
      } finally {
        setPending((prev) => {
          const next = { ...prev }
          delete next[slug]
          return next
        })
      }
    },
    [refreshProcs, scan],
  )

  const start = useCallback(
    (project: Project) =>
      withPending(project.slug, 'start', async () => {
        const res = await ldt.start(project.root, { restart: true })
        for (const note of res.notes ?? []) toast.info(note)
        startedHere.current.add(project.slug)
        updatePrefs((p) => ({ ...p, recent: { ...p.recent, [project.slug]: Date.now() } }))
      }),
    [withPending, updatePrefs],
  )

  const stop = useCallback(
    (project: Project, proc: DevProc) =>
      withPending(project.slug, 'stop', async () => {
        startedHere.current.delete(project.slug)
        await ldt.stop(proc.name)
      }),
    [withPending],
  )

  const toggleFavorite = useCallback(
    (slug: string) =>
      updatePrefs((p) => ({
        ...p,
        favorites: p.favorites.includes(slug) ? p.favorites.filter((s) => s !== slug) : [...p.favorites, slug],
      })),
    [updatePrefs],
  )

  const setRoot = useCallback((root: string) => updatePrefs((p) => ({ ...p, root })), [updatePrefs])
  const setAutoOpen = useCallback((autoOpen: boolean) => updatePrefs((p) => ({ ...p, autoOpen })), [updatePrefs])

  const views = useMemo<ProjectView[]>(() => {
    // Favoritos, despues lo que corre, despues lo usado hace poco. Lo que no se puede
    // levantar (librerias, CLIs como el propio ldt) va al fondo.
    const rank = (v: ProjectView) =>
      (v.dev_cmd ? 0 : 4) +
      (v.favorite ? 0 : 2) +
      (v.status.kind === 'running' || v.status.kind === 'starting' ? 0 : 1)
    return projects
      .map((p) => ({
        ...p,
        status: statusOf(p, procs),
        favorite: prefs.favorites.includes(p.slug),
        lastUsed: prefs.recent[p.slug] ?? 0,
        pending: pending[p.slug] ?? null,
      }))
      .sort((a, b) => rank(a) - rank(b) || b.lastUsed - a.lastUsed || a.rel.localeCompare(b.rel))
  }, [projects, procs, prefs, pending])

  return {
    root: prefs.root,
    setRoot,
    autoOpen: prefs.autoOpen,
    setAutoOpen,
    projects: views,
    scanning,
    error,
    scan,
    start,
    stop,
    toggleFavorite,
  }
}
