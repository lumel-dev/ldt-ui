import {
  CodeXmlIcon,
  ExternalLinkIcon,
  FolderOpenIcon,
  GitBranchIcon,
  Loader2Icon,
  PlayIcon,
  ScrollTextIcon,
  SquareIcon,
  StarIcon,
  TerminalIcon,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { ProjectView, Status } from '@/hooks/use-workspace'
import { ldt, type DevProc } from '@/lib/ldt'
import { cn } from '@/lib/utils'

interface Props {
  project: ProjectView
  onStart: () => void
  onStop: (proc: DevProc) => void
  onLogs: (proc: DevProc) => void
  onFavorite: () => void
}

function StatusLine({ status, port }: { status: Status; port: number | null }) {
  const dot = (color: string, pulse = false) => (
    <span className="relative flex size-2">
      {pulse && <span className={cn('absolute inline-flex size-full animate-ping rounded-full opacity-60', color)} />}
      <span className={cn('relative inline-flex size-2 rounded-full', color)} />
    </span>
  )
  switch (status.kind) {
    case 'running':
      return (
        <span className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
          {dot('bg-emerald-500', true)} Corriendo en :{status.proc.port ?? port}
        </span>
      )
    case 'starting':
      return (
        <span className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
          <Loader2Icon className="size-3.5 animate-spin" /> Arrancando…
        </span>
      )
    case 'crashed':
      return <span className="flex items-center gap-2 text-destructive">{dot('bg-destructive')} Se cayó</span>
    case 'port-taken':
      return (
        <span className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
          {dot('bg-amber-500')} :{status.owner.port}{' '}
          {status.by ? `en uso por ${status.by}` : `ocupado por ${status.owner.process}`}
        </span>
      )
    default:
      return <span className="flex items-center gap-2 text-muted-foreground">{dot('bg-muted-foreground/40')} Detenido</span>
  }
}

function IconAction({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<Button size="icon-sm" variant="ghost" aria-label={label} onClick={onClick} />}>
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

export function ProjectCard({ project, onStart, onStop, onLogs, onFavorite }: Props) {
  const { status, pending } = project
  const proc = 'proc' in status ? status.proc : null
  const live = status.kind === 'running' || status.kind === 'starting'
  const group = project.rel.includes('/') ? project.rel.slice(0, project.rel.lastIndexOf('/') + 1) : ''
  const stack = project.framework?.split('@')[0] ?? project.kind
  const canStart = Boolean(project.dev_cmd)

  return (
    <article
      className={cn(
        'group/card flex flex-col gap-3 rounded-xl border bg-card p-4 text-card-foreground shadow-sm shadow-black/30 transition-[border-color,box-shadow]',
        live
          ? 'border-emerald-500/30 shadow-[0_8px_28px_-14px] shadow-emerald-500/50'
          : status.kind === 'crashed'
            ? 'border-destructive/40'
            : 'hover:border-brand/30 hover:shadow-[0_8px_28px_-14px] hover:shadow-brand/40',
      )}
    >
      <header className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          {group && <p className="truncate text-[11px] font-medium text-brand/70">{group}</p>}
          <h2 className="truncate font-heading text-base font-semibold" title={project.root}>
            {project.name}
          </h2>
        </div>
        <button
          type="button"
          onClick={onFavorite}
          aria-label={project.favorite ? 'Quitar de favoritos' : 'Marcar como favorito'}
          className={cn(
            'rounded-md p-1 text-muted-foreground transition hover:text-amber-500',
            project.favorite ? 'text-amber-500' : 'opacity-0 group-hover/card:opacity-100 focus-visible:opacity-100',
          )}
        >
          <StarIcon className={cn('size-4', project.favorite && 'fill-current')} />
        </button>
      </header>

      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <Badge variant="outline" className="border-brand/25 bg-brand/10 text-brand">
          {stack}
        </Badge>
        {project.port && canStart && <Badge variant="outline" className="font-mono">:{project.port}</Badge>}
        {project.git?.branch && (
          <span className="flex items-center gap-1 text-muted-foreground">
            <GitBranchIcon className="size-3" />
            {project.git.branch}
            {project.git.dirty_files ? <span className="text-amber-600 dark:text-amber-400">·{project.git.dirty_files}</span> : null}
          </span>
        )}
      </div>

      <p
        className="truncate rounded-md border border-white/5 bg-background/70 px-2.5 py-1.5 font-mono text-xs text-muted-foreground"
        title={proc?.cmd ?? project.dev_cmd ?? ''}
      >
        {canStart ? (
          <>
            <span className="text-brand/70 select-none">$ </span>
            {proc?.cmd ?? project.dev_cmd}
          </>
        ) : (
          <span className="italic">Sin comando de dev detectado</span>
        )}
      </p>

      <div className="text-xs">
        <StatusLine status={status} port={project.port} />
      </div>

      <footer className="mt-auto flex items-center gap-1 border-t pt-3">
        {live || status.kind === 'crashed' ? (
          <Button size="sm" variant="outline" disabled={pending !== null} onClick={() => proc && onStop(proc)}>
            {pending === 'stop' ? <Loader2Icon className="animate-spin" /> : <SquareIcon />}
            {status.kind === 'crashed' ? 'Limpiar' : 'Parar'}
          </Button>
        ) : (
          <Button size="sm" disabled={!canStart || pending !== null} onClick={onStart}>
            {pending === 'start' ? <Loader2Icon className="animate-spin" /> : <PlayIcon />}
            Levantar
          </Button>
        )}
        {status.kind === 'running' && status.proc.url && (
          <Button size="sm" variant="ghost" onClick={() => ldt.open('url', status.proc.url!)}>
            <ExternalLinkIcon /> Abrir
          </Button>
        )}
        <div className="ml-auto flex items-center">
          {proc && (
            <IconAction label="Logs" onClick={() => onLogs(proc)}>
              <ScrollTextIcon />
            </IconAction>
          )}
          <IconAction label="Abrir en VS Code" onClick={() => ldt.open('editor', project.root)}>
            <CodeXmlIcon />
          </IconAction>
          <IconAction label="Abrir carpeta" onClick={() => ldt.open('folder', project.root)}>
            <FolderOpenIcon />
          </IconAction>
          <IconAction label="Abrir terminal" onClick={() => ldt.open('terminal', project.root)}>
            <TerminalIcon />
          </IconAction>
        </div>
      </footer>
    </article>
  )
}
