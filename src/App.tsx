import { useState, type FormEvent } from 'react'
import { FolderIcon, RefreshCwIcon, SearchIcon } from 'lucide-react'
import { LogSheet } from '@/components/log-sheet'
import { ProjectCard } from '@/components/project-card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { useWorkspace, type ProjectView } from '@/hooks/use-workspace'
import { cn } from '@/lib/utils'

type Filter = 'all' | 'favorites' | 'running'

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'Todos' },
  { id: 'favorites', label: 'Favoritos' },
  { id: 'running', label: 'Corriendo' },
]

function matches(p: ProjectView, filter: Filter, query: string) {
  if (filter === 'favorites' && !p.favorite) return false
  if (filter === 'running' && p.status.kind !== 'running' && p.status.kind !== 'starting') return false
  if (!query) return true
  const q = query.toLowerCase()
  return [p.rel, p.framework ?? '', p.kind].some((s) => s.toLowerCase().includes(q))
}

// "ldt" en mono, como se tipea en la terminal, y "ui" en el color de acento.
function Brand({ large }: { large?: boolean }) {
  return (
    <span className={cn('flex items-center', large ? 'mb-4 gap-3' : 'gap-2')}>
      <img src="/favicon.svg" alt="" className={large ? 'size-10' : 'size-6'} />
      <span className={cn('font-mono font-bold tracking-tight text-brand', large ? 'text-3xl' : 'text-lg')}>
        <span className="text-foreground">ldt</span> ui
      </span>
    </span>
  )
}

function RootForm({ initial, onSubmit, compact }: { initial: string; onSubmit: (root: string) => void; compact?: boolean }) {
  const [value, setValue] = useState(initial)
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (value.trim()) onSubmit(value.trim())
  }
  return (
    <form onSubmit={submit} className={cn('flex gap-2', compact ? 'w-full' : 'w-full max-w-lg')}>
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="D:/Repos o ~/code"
        className="font-mono text-xs"
        aria-label="Carpeta de trabajo"
        autoFocus
      />
      <Button type="submit" variant={compact ? 'outline' : 'default'}>
        {compact ? 'Cambiar' : 'Escanear'}
      </Button>
    </form>
  )
}

export default function App() {
  const ws = useWorkspace()
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [logsFor, setLogsFor] = useState<string | null>(null)
  const [editingRoot, setEditingRoot] = useState(false)

  if (!ws.root) {
    return (
      <main className="flex min-h-svh flex-col items-center justify-center gap-4 p-6 text-center">
        <Brand large />
        <h1 className="font-heading text-2xl font-semibold">¿Dónde están tus proyectos?</h1>
        <p className="max-w-md text-sm text-muted-foreground">
          La carpeta que los contiene. Se recorre con <code className="font-mono">ldt scan --all</code>, hasta tres niveles de
          profundidad.
        </p>
        <RootForm initial="" onSubmit={ws.setRoot} />
      </main>
    )
  }

  const shown = ws.projects.filter((p) => matches(p, filter, query))
  const running = ws.projects.filter((p) => p.status.kind === 'running').length
  const logsProject = ws.projects.find((p) => p.slug === logsFor) ?? null
  const logsProc = logsProject && 'proc' in logsProject.status ? logsProject.status.proc : null

  return (
    <div className="min-h-svh">
      <header className="sticky top-0 z-10 border-b bg-background/75 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
          <div className="flex items-center gap-3">
            <Brand />
            <span className="hidden items-center gap-1.5 rounded-full border bg-card px-2.5 py-0.5 text-xs text-muted-foreground sm:flex">
              {ws.projects.length} proyectos
              {running > 0 && (
                <>
                  <span className="text-border">·</span>
                  <span className="size-1.5 rounded-full bg-emerald-400" />
                  <span className="text-emerald-400">{running} corriendo</span>
                </>
              )}
            </span>
          </div>
          <div className="min-w-0 flex-1">
            {editingRoot ? (
              <RootForm
                compact
                initial={ws.root}
                onSubmit={(root) => {
                  ws.setRoot(root)
                  setEditingRoot(false)
                }}
              />
            ) : (
              <button
                type="button"
                onClick={() => setEditingRoot(true)}
                className="flex max-w-full items-center gap-1.5 truncate rounded-md px-2 py-1 font-mono text-xs text-muted-foreground transition-colors hover:bg-elevated hover:text-foreground"
                title="Cambiar carpeta de trabajo"
              >
                <FolderIcon className="size-3.5 shrink-0" />
                <span className="truncate">{ws.root}</span>
              </button>
            )}
          </div>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <Switch checked={ws.autoOpen} onCheckedChange={ws.setAutoOpen} />
            Abrir al levantar
          </label>
          <Button size="icon-sm" variant="ghost" aria-label="Volver a escanear" onClick={ws.scan} disabled={ws.scanning}>
            <RefreshCwIcon className={cn(ws.scanning && 'animate-spin')} />
          </Button>
        </div>
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-2 px-4 pb-3">
          <div className="flex rounded-lg border bg-card p-0.5">
            {FILTERS.map((f) => {
              const count = ws.projects.filter((p) => matches(p, f.id, '')).length
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setFilter(f.id)}
                  className={cn(
                    'flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                    filter === f.id
                      ? 'bg-elevated text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {f.label}
                  <span className={cn('tabular-nums', filter === f.id ? 'text-brand' : 'text-muted-foreground/60')}>
                    {count}
                  </span>
                </button>
              )
            })}
          </div>
          <div className="relative w-full sm:ml-auto sm:max-w-xs">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar proyecto o stack"
              className="h-8 bg-card pl-8 text-sm"
            />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6">
        {ws.error && (
          <div className="mb-4 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {ws.error}
          </div>
        )}
        {ws.scanning && ws.projects.length === 0 ? (
          <p className="py-20 text-center text-sm text-muted-foreground">Escaneando {ws.root}…</p>
        ) : shown.length === 0 ? (
          <p className="py-20 text-center text-sm text-muted-foreground">
            {ws.projects.length === 0 ? 'No encontré proyectos en esa carpeta.' : 'Nada coincide con el filtro.'}
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {shown.map((p) => (
              <ProjectCard
                key={p.root}
                project={p}
                onStart={() => ws.start(p)}
                onStop={(proc) => ws.stop(p, proc)}
                onLogs={() => setLogsFor(p.slug)}
                onFavorite={() => ws.toggleFavorite(p.slug)}
              />
            ))}
          </div>
        )}
      </main>

      <LogSheet title={logsProject?.name ?? ''} proc={logsProc} onClose={() => setLogsFor(null)} />
    </div>
  )
}
