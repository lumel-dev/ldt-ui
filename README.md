# Lumel Devtools UI

Panel de escritorio para levantar los proyectos de desarrollo de una carpeta con un clic:
ver qué hay, qué corre y en qué puerto, levantar y parar, abrir en el navegador, en la
terminal o en VS Code, y seguir los logs en vivo.

Es la cara humana de [`ldt`](https://github.com/lumel-dev/ldt): toda la detección y el
manejo de procesos los hace `ldt`, y lo que la UI levanta es lo mismo que ven `ldt status`
y los agentes de código.

## Requisitos

- [`ldt`](https://github.com/lumel-dev/ldt) instalado y en el PATH (o `LDT_PY` apuntando
  a su `ldt.py`).
- Node 20+ y pnpm.
- Para la app de escritorio: Rust y, en Windows, las MSVC Build Tools con "Desarrollo
  para el escritorio con C++". WebView2 ya viene con Windows 10/11.

## Uso

```bash
pnpm install
pnpm tauri dev      # la app de escritorio
pnpm tauri build    # instaladores (.msi / .exe) en src-tauri/target/release/bundle
pnpm dev            # sólo la UI, en http://localhost:5173
```

La primera vez pide la carpeta de trabajo (por ejemplo `~/code` o `D:/Repos`). Se recorre
con `ldt scan --all`, hasta tres niveles de profundidad. La carpeta, los favoritos y el uso
reciente quedan en el `localStorage` de la app; nada sale de la máquina.

| Variable      | Para qué                                                    |
| ------------- | ----------------------------------------------------------- |
| `LDT_PY`      | ruta a `ldt.py`, si `ldt` no está en el PATH                |
| `LDT_PYTHON`  | el intérprete con que se corre (`python` / `python3` por defecto) |

Detalles de diseño y reglas para trabajar sobre el repo: [AGENTS.md](AGENTS.md).

## Licencia

MIT
