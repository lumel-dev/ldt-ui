# AGENTS.md

Guía para trabajar **sobre** `ldt-ui`: la UI de escritorio de `ldt` para personas. Para
*usarla*, ver `README.md`.

## Qué es

Un panel que lista los proyectos de una carpeta de trabajo y los levanta, para, abre y
muestra sus logs. **No sabe hacer nada de eso por sí mismo**: todo lo hace
[`ldt`](https://github.com/lumel-dev/ldt) y la UI lo invoca con `--json`.

```
src/lib/ldt.ts             cliente tipado de ldt (contrato --json v1) y sus dos transportes
src/lib/prefs.ts           preferencias humanas: carpeta, favoritos, uso reciente
src/hooks/use-workspace.ts scan + polling de `dev list`, estado de cada proyecto, acciones
src/components/            tarjeta de proyecto, panel de logs; ui/ es shadcn (Base UI)
bridge/vite-plugin-ldt.ts  puente de desarrollo: las operaciones en /__ldt/* bajo `pnpm dev`
src-tauri/src/lib.rs       app de escritorio: las mismas operaciones como comandos de Tauri
```

## Reglas

**La lógica va en `ldt`, no acá.** Detectar un stack, elegir un puerto, saber si un proceso
es nuestro, matar un árbol de procesos: todo eso ya lo resuelve `ldt` y lo usan también los
agentes. Si la UI necesita algo que `ldt` no da, se agrega a `ldt` y se consume por
`--json`. Acá sólo vive lo que es de una persona:
favoritos, orden, carpeta de trabajo.

**El contrato es `--json` v1.** Los tipos de `src/lib/ldt.ts` lo reflejan y `checkVersion`
corta si `ldt` responde con otra versión. Las reglas del contrato están en el `AGENTS.md`
de `ldt`, sección "El contrato de `--json`".

**Dos transportes, las mismas operaciones.** `scan`, `list`, `start`, `stop`, `readLog`,
`open`, con los mismos argumentos en el puente de Vite y en los comandos de Tauri.
`src/lib/ldt.ts` elige con `isTauri()`; en Rust los nombres van en snake_case (`readLog`
→ `read_log`) y el transporte los convierte. Una operación nueva se agrega en los dos lados
o en ninguno.

**El puente ejecuta comandos en la máquina.** Por eso sólo acepta operaciones conocidas y
arma el argv él mismo (nunca lo recibe del cliente), rechaza requests cuyo `Host` u
`Origin` no sea localhost (DNS rebinding, CSRF), y `readLog` sólo lee `.log` dentro de un
`logs/`. Existe sólo en `pnpm dev` (`apply: 'serve'`). Los comandos de Tauri respetan lo
mismo (menos Host/Origin, que ahí no aplica: sólo los llama el WebView de la app).

**`port_owner` es una foto; los procesos, no.** El scan cuesta un par de segundos (git en
cada repo) y corre cada 30 s; `dev list` corre cada 1–4 s. `statusOf` cruza las dos cosas:
un `port_owner` cuyo pid es de un server de `ldt` vivo se muestra con su nombre, y uno que
era de `ldt` y ya no está se ignora (quedó viejo). Después de parar o de que un server
quede listo se vuelve a escanear.

**Nada de trabajo en el hilo de la UI.** Los comandos de Tauri son `async` y todo lo que
lanza un proceso o lee disco va por `spawn_blocking`: un `ldt scan` tarda un par de
segundos y congelaría la ventana. Cada invocación de python va con `CREATE_NO_WINDOW`: la
app es GUI y sin eso cada `dev list` haría parpadear una consola.

**Windows es el entorno real.** Abrir una URL va por `rundll32 url.dll,FileProtocolHandler`
y la terminal por `cmd /c start cmd.exe` con la carpeta como `cwd`: nada que tenga que
citarse para el parser de `cmd`, donde un `&` de una query string corta el comando. VS Code
igual: `code` es un `.cmd`, así que va `cmd /c code .` con la carpeta como `cwd`.

## Desarrollo

```bash
pnpm install
ldt dev start                          # sólo la UI en el navegador, con el puente de Vite
ldt browser check http://localhost:5173/
pnpm tauri dev                         # la app de escritorio (levanta su propio Vite)
pnpm tauri build                       # instaladores en src-tauri/target/release/bundle
```

`ldt` se encuentra por el PATH (`<repo>/bin/ldt` → `<repo>/ldt.py`), o con `LDT_PY`.
`LDT_PYTHON` cambia el intérprete. Para compilar hace falta Rust y, en Windows, las MSVC
Build Tools con "Desarrollo para el escritorio con C++" (el `link.exe` y el Windows SDK).

Un cambio de UI no está verificado hasta verlo andando, incluido el ciclo levantar → listo
→ logs → parar. En el navegador: `ldt browser check` + `ldt browser errors`. En la app de
escritorio, `ldt browser` no llega a la ventana: se la arranca con
`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9333` y se la maneja con
Playwright por `connect_over_cdp("http://127.0.0.1:9333")`. La CSP de `tauri.conf.json`
sólo rige en el build de release (`pnpm tauri build --no-bundle`): un cambio que cargue
algo de afuera se prueba ahí, no en `tauri dev`.

`src/components/ui/` sale de shadcn, pero `cn` va con `clsx` + `tailwind-merge` en
`src/lib/utils.ts`: el CLI actual de shadcn genera `import { cn } from "cn"`, un paquete de
npm sin repositorio declarado. Al agregar un componente, cambiar ese import.
