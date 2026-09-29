# Lumel Devtools UI

Panel de escritorio para levantar los proyectos de desarrollo de una carpeta con un clic:
ver qué hay, qué corre y en qué puerto, levantar y parar, abrir en el navegador, en la
terminal o en VS Code, y seguir los logs en vivo.

Es la cara humana de [`ldt`](https://github.com/lumel-dev/ldt): toda la detección y el
manejo de procesos los hace `ldt`, y lo que la UI levanta es lo mismo que ven `ldt status`
y los agentes de código.

![Lumel Devtools UI: la grilla de proyectos, con uno corriendo](docs/screenshot.png)

## Instalación

Bajá el instalador de la [última release](https://github.com/lumel-dev/ldt-ui/releases/latest)
y listo: la app ya viene compilada, no hace falta Node ni Rust.

- `ldt-ui_<versión>_x64-setup.exe`: instala para tu usuario, sin permisos de administrador.
- `ldt-ui_<versión>_x64_en-US.msi`: lo mismo en formato MSI.

Lo único que necesita es [`ldt`](https://github.com/lumel-dev/ldt) instalado y en el PATH,
porque la app no hace nada por su cuenta: todo lo pide a `ldt`. WebView2 ya viene con
Windows 10/11. Los instaladores no están firmados, así que la primera vez SmartScreen
puede avisar ("Más información" → "Ejecutar de todas formas").

Por ahora hay instaladores sólo para Windows x64. En Linux o macOS se compila desde el
código (abajo).

## Uso

La primera vez pide la carpeta de trabajo (por ejemplo `~/code` o `D:/Repos`). Se recorre
con `ldt scan --all`, hasta tres niveles de profundidad. La carpeta, los favoritos y el uso
reciente quedan en el `localStorage` de la app; nada sale de la máquina.

| Variable      | Para qué                                                          |
| ------------- | ----------------------------------------------------------------- |
| `LDT_PY`      | ruta a `ldt.py`, si `ldt` no está en el PATH                      |
| `LDT_PYTHON`  | el intérprete con que se corre (`python` / `python3` por defecto) |

## Compilar desde el código

Sólo si querés modificar la app o generar tus propios instaladores. Además de `ldt` hace
falta:

- Node 20+ y pnpm.
- Rust y, en Windows, las MSVC Build Tools con "Desarrollo para el escritorio con C++".

```bash
pnpm install
pnpm dev            # sólo la UI, en el navegador (http://localhost:5173)
pnpm tauri dev      # la app de escritorio, con recarga en caliente
pnpm tauri build    # instaladores (.msi / .exe) en src-tauri/target/release/bundle
```

Detalles de diseño y reglas para trabajar sobre el repo: [AGENTS.md](AGENTS.md).

## Licencia

MIT
