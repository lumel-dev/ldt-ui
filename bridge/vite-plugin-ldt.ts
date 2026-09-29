/**
 * Puente de desarrollo: expone las operaciones de `ldt` en `/__ldt/*` mientras corre
 * `pnpm dev`, para trabajar la UI en el navegador con datos reales.
 *
 * Es el mismo contrato que despues implementan los comandos de Tauri (`src-tauri`): cada
 * operacion de aca es un `invoke` alla. No existe en el build: `apply: 'serve'`.
 *
 * Ejecuta comandos en la maquina, asi que:
 * - solo operaciones conocidas, con argumentos armados aca (nunca un argv del cliente);
 * - solo requests cuyo Host y Origin sean localhost (corta DNS rebinding y CSRF);
 * - `readLog` solo lee archivos `.log` dentro de un directorio `logs/` de ldt.
 */
import { execFile, spawn } from 'node:child_process'
import { existsSync, realpathSync, statSync } from 'node:fs'
import { open } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import path from 'node:path'
import type { Plugin } from 'vite'

const IS_WIN = process.platform === 'win32'
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/**
 * `ldt.py` a partir del shim que esta en el PATH (`<repo>/bin/ldt`), o de LDT_PY. En Linux
 * y macOS el shim es un symlink (`~/.local/bin/ldt`): se resuelve, porque `ldt.py` esta al
 * lado del archivo real y no del link.
 */
function findLdt(): string {
  if (process.env.LDT_PY) return process.env.LDT_PY
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    if (!dir) continue
    const shim = path.join(dir, 'ldt')
    if (!existsSync(shim)) continue
    const script = path.resolve(path.dirname(realpathSync(shim)), '..', 'ldt.py')
    if (existsSync(script)) return script
  }
  throw new Error('no encontre ldt: ponelo en el PATH o defini LDT_PY=/ruta/a/ldt.py')
}

/** Si `cmd` esta en el PATH. Sirve para elegir antes de lanzar: `spawn` avisa tarde. */
function onPath(cmd: string): boolean {
  return (process.env.PATH ?? '').split(path.delimiter).some((dir) => dir && existsSync(path.join(dir, cmd)))
}

/** Linux no tiene una terminal por defecto: `x-terminal-emulator` es de Debian/Ubuntu. */
const LINUX_TERMINALS = [
  'x-terminal-emulator',
  'gnome-terminal',
  'konsole',
  'xfce4-terminal',
  'kitty',
  'alacritty',
  'wezterm',
  'foot',
  'xterm',
]

const PYTHON = process.env.LDT_PYTHON ?? (IS_WIN ? 'python' : 'python3')

interface RunResult {
  ok: boolean
  data: unknown
  error?: string
}

function runLdt(args: string[], timeout = 60_000): Promise<RunResult> {
  return new Promise((resolve) => {
    let script: string
    try {
      script = findLdt()
    } catch (err) {
      resolve({ ok: false, data: null, error: (err as Error).message })
      return
    }
    execFile(
      PYTHON,
      [script, ...args, '--json'],
      { timeout, windowsHide: true, maxBuffer: 16 * 1024 * 1024, encoding: 'utf8' },
      (err, stdout, stderr) => {
        let data: unknown = null
        try {
          data = JSON.parse(stdout)
        } catch {
          // Sin JSON: un error de argparse o un `core.die`, que salen por stderr.
        }
        if (!err) return resolve({ ok: true, data })
        const message = stderr.trim().replace(/^error:\s*/, '') || err.message
        resolve({ ok: false, data, error: message })
      },
    )
  })
}

function isDir(p: unknown): p is string {
  return typeof p === 'string' && path.isAbsolute(p) && existsSync(p) && statSync(p).isDirectory()
}

async function readLog(file: string, offset: number) {
  const resolved = path.resolve(file)
  if (!resolved.endsWith('.log') || path.basename(path.dirname(resolved)) !== 'logs') {
    throw new Error('solo se leen logs de ldt')
  }
  const MAX = 256 * 1024
  const fh = await open(resolved, 'r')
  try {
    const { size } = await fh.stat()
    let start = offset
    let reset = false
    // -1 = primera lectura: solo la cola. Un archivo mas chico que el offset se trunco
    // (un `dev start` nuevo lo vacia), y hay que volver a empezar.
    if (offset < 0 || offset > size) {
      start = Math.max(0, size - 64 * 1024)
      reset = true
    }
    const length = Math.min(size - start, MAX)
    const buf = Buffer.alloc(length)
    if (length > 0) await fh.read(buf, 0, length, start)
    return { text: buf.toString('utf8'), offset: start + length, reset }
  } finally {
    await fh.close()
  }
}

function launch(cmd: string, args: string[], cwd?: string) {
  spawn(cmd, args, { cwd, detached: true, stdio: 'ignore', windowsHide: false }).unref()
}

function openTarget(kind: string, target: string) {
  if (kind === 'url') {
    if (!/^https?:\/\/[^\s"]+$/.test(target)) throw new Error('url invalida')
    // rundll32 en vez de `cmd /c start`: la URL no pasa por el parser de cmd, donde un `&`
    // de la query string cortaria el comando.
    if (IS_WIN) launch('rundll32.exe', ['url.dll,FileProtocolHandler', target])
    else launch(process.platform === 'darwin' ? 'open' : 'xdg-open', [target])
    return
  }
  if (!isDir(target)) throw new Error('no existe la carpeta')
  if (kind === 'folder') {
    if (IS_WIN) launch('explorer.exe', [target])
    else launch(process.platform === 'darwin' ? 'open' : 'xdg-open', [target])
  } else if (kind === 'terminal') {
    // La carpeta va como cwd, no como argumento: asi no hay que citarla para cmd.
    if (IS_WIN) launch('cmd.exe', ['/c', 'start', 'cmd.exe'], target)
    else if (process.platform === 'darwin') launch('open', ['-a', 'Terminal', target])
    else {
      const term = [process.env.TERMINAL, ...LINUX_TERMINALS].find((t) => t && onPath(t))
      if (!term) throw new Error('no encontre una terminal: defini TERMINAL con la que uses')
      launch(term, [], target)
    }
  } else if (kind === 'editor') {
    // `code` en Windows es un .cmd y tiene que pasar por cmd: por eso `code .` con la
    // carpeta como cwd, igual que la terminal, y no la ruta como argumento.
    if (IS_WIN) spawn('cmd.exe', ['/c', 'code', '.'], { cwd: target, detached: true, stdio: 'ignore', windowsHide: true }).unref()
    // En macOS `code` solo existe si se lo instalo desde VS Code; si no, se abre la app.
    else if (process.platform === 'darwin' && !onPath('code')) launch('open', ['-a', 'Visual Studio Code', target])
    else launch('code', ['.'], target)
  } else {
    throw new Error(`no se abrir "${kind}"`)
  }
}

function hostOf(value: string | undefined): string | null {
  if (!value) return null
  try {
    return new URL(value.includes('://') ? value : `http://${value}`).hostname
  } catch {
    return null
  }
}

function isLocal(req: IncomingMessage): boolean {
  const host = hostOf(req.headers.host)
  if (!host || !LOCAL_HOSTS.has(host === '::1' ? '[::1]' : host)) return false
  const origin = req.headers.origin
  if (origin && !LOCAL_HOSTS.has(hostOf(origin) ?? '')) return false
  return true
}

async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const c of req) chunks.push(c as Buffer)
  if (!chunks.length) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function send(res: ServerResponse, status: number, payload: unknown) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(payload))
}

type Handler = (b: Record<string, unknown>) => Promise<RunResult>

const OPS: Record<string, Handler> = {
  scan: async (b) => {
    if (!isDir(b.root)) return { ok: false, data: null, error: 'la carpeta no existe' }
    return runLdt(['scan', '--all', b.root])
  },
  list: () => runLdt(['dev', 'list']),
  start: async (b) => {
    if (!isDir(b.cwd)) return { ok: false, data: null, error: 'la carpeta no existe' }
    const args = ['--cwd', b.cwd, 'dev', 'start', '--settle', '0']
    if (typeof b.port === 'number' && Number.isInteger(b.port)) args.push('--port', String(b.port))
    if (b.restart === true) args.push('--restart')
    return runLdt(args)
  },
  stop: async (b) => {
    if (typeof b.name !== 'string' || !/^[\w.@-]+$/.test(b.name)) {
      return { ok: false, data: null, error: 'nombre invalido' }
    }
    return runLdt(['dev', 'stop', b.name])
  },
  readLog: async (b) => {
    try {
      const data = await readLog(String(b.path ?? ''), Number(b.offset ?? -1))
      return { ok: true, data }
    } catch (err) {
      return { ok: false, data: null, error: (err as Error).message }
    }
  },
  open: async (b) => {
    try {
      openTarget(String(b.kind), String(b.target))
      return { ok: true, data: null }
    } catch (err) {
      return { ok: false, data: null, error: (err as Error).message }
    }
  },
}

export function ldtBridge(): Plugin {
  return {
    name: 'ldt-bridge',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__ldt', async (req, res) => {
        if (!isLocal(req)) return send(res, 403, { ok: false, error: 'solo desde localhost' })
        if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'POST' })
        const op = (req.url ?? '').replace(/^\//, '').split('?')[0]
        const handler = OPS[op]
        if (!handler) return send(res, 404, { ok: false, error: `operacion desconocida: ${op}` })
        try {
          send(res, 200, await handler(await body(req)))
        } catch (err) {
          send(res, 500, { ok: false, error: (err as Error).message })
        }
      })
    },
  }
}
