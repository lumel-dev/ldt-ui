/**
 * Cliente de `ldt`. La UI no sabe detectar proyectos ni manejar procesos: todo eso lo
 * hace `ldt` y aca solo se lo invoca. Los tipos siguen el contrato `--json` v1
 * (ver "El contrato de `--json`" en el AGENTS.md de ldt).
 *
 * Dos transportes con las mismas operaciones: el puente de Vite (`/__ldt/*`, en
 * `pnpm dev` desde el navegador) y, dentro de la app de escritorio, los comandos de Tauri.
 */

import { invoke, isTauri } from '@tauri-apps/api/core'

export const API_VERSION = 1

export interface DevProc {
  name: string
  pid: number
  port_pid: number | null
  alive: boolean
  ready: boolean
  port: number | null
  url: string | null
  cmd: string
  cwd: string
  log: string
  uptime_s: number
}

export interface PortOwner {
  port: number
  addr: string
  pid: number | null
  process: string
  ldt: boolean
}

export interface Project {
  name: string
  slug: string
  rel: string
  root: string
  kind: string
  framework: string | null
  package_manager: string | null
  dev_cmd: string | null
  port: number | null
  has_docker: boolean
  env_files: string[]
  port_owner: PortOwner | null
  dev: DevProc[]
  git: { branch: string | null; dirty_files: number | null } | null
}

export interface LogChunk {
  text: string
  offset: number
  reset: boolean
}

export type OpenKind = 'url' | 'folder' | 'terminal' | 'editor'

export class LdtError extends Error {}

interface Envelope<T> {
  ok: boolean
  data: T
  error?: string
}

type Transport = <T>(op: string, args?: Record<string, unknown>) => Promise<Envelope<T>>

const bridge: Transport = async (op, args = {}) => {
  const res = await fetch(`/__ldt/${op}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  })
  return res.json()
}

// Los comandos de `src-tauri/src/lib.rs`: mismas operaciones y argumentos que el puente.
// En Rust los nombres van en snake_case (`readLog` -> `read_log`).
const tauri: Transport = (op, args = {}) =>
  invoke(op.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`), args)

const transport: Transport = isTauri() ? tauri : bridge

function checkVersion(data: unknown) {
  const v = (data as { v?: number } | null)?.v
  if (typeof v === 'number' && v !== API_VERSION) {
    throw new LdtError(`ldt habla la version ${v} del contrato y esta UI la ${API_VERSION}: actualizá los dos`)
  }
}

async function call<T>(op: string, args?: Record<string, unknown>): Promise<T> {
  const res = await transport<T>(op, args)
  if (res.data) checkVersion(res.data)
  if (!res.ok) throw new LdtError(res.error ?? `falló ${op}`)
  return res.data
}

export const ldt = {
  scan: (root: string) => call<{ base: string; projects: Project[] }>('scan', { root }),
  list: () => call<{ procs: DevProc[] }>('list').then((d) => d.procs),
  start: (cwd: string, opts: { port?: number; restart?: boolean } = {}) =>
    call<DevProc & { notes: string[] }>('start', { cwd, ...opts }),
  stop: (name: string) => call<{ stopped: string[] }>('stop', { name }),
  readLog: (path: string, offset: number) => call<LogChunk>('readLog', { path, offset }),
  open: (kind: OpenKind, target: string) => call<null>('open', { kind, target }),
}

/** Si un proceso de `ldt` pertenece a un proyecto: mismo criterio que `core.belongs`. */
export function belongs(cwd: string, root: string): boolean {
  const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  const a = norm(cwd)
  const b = norm(root)
  return a === b || a.startsWith(`${b}/`)
}
