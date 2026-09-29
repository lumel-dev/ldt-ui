//! Comandos de la app de escritorio.
//!
//! Son las mismas operaciones que el puente de desarrollo (`bridge/vite-plugin-ldt.ts`),
//! con los mismos argumentos y la misma respuesta `{ ok, data, error }`: el frontend no
//! distingue en cual de los dos corre. Toda la logica es de `ldt`; aca solo se lo invoca.
//!
//! Ejecutan cosas en la maquina, asi que valen las mismas reglas que en el puente: solo
//! operaciones conocidas, argv armado aca (nunca recibido del frontend), carpetas que
//! existan, y `read_log` limitado a los `.log` de un directorio `logs/`.

use serde::Serialize;
use serde_json::{Value, json};
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

#[derive(Serialize)]
struct Envelope {
    ok: bool,
    data: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

impl Envelope {
    fn ok(data: Value) -> Self {
        Self { ok: true, data, error: None }
    }

    fn err(msg: impl Into<String>) -> Self {
        Self { ok: false, data: Value::Null, error: Some(msg.into()) }
    }

    fn from(result: Result<Value, String>) -> Self {
        result.map_or_else(Self::err, Self::ok)
    }
}

/// Sin esto cada invocacion de python abre y cierra una consola: la app es GUI.
fn hidden(cmd: &mut Command) -> &mut Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

/// En macOS una app abierta desde el Finder o el Dock hereda el PATH de launchd
/// (`/usr/bin:/bin:/usr/sbin:/sbin`), no el de la shell, y en Linux muchos lanzadores
/// tampoco leen el `.bashrc` / `.zshrc`. Sin el PATH de la persona no aparecen ni `ldt`
/// (que `install.sh` deja en `~/.local/bin`) ni el `node` / `pnpm` con que `ldt` levanta
/// los proyectos. Se le pide una vez a su shell de login, al arrancar.
#[cfg(not(windows))]
fn adopt_login_path() {
    use std::time::{Duration, Instant};

    const MARK: &str = "__LDT_UI_PATH__";
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".into());
    let child = Command::new(&shell)
        .args(["-ilc", &format!("printf '{MARK}%s{MARK}' \"$PATH\"")])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn();
    let mut from_shell = None;
    if let Ok(mut child) = child {
        // Un rc que se cuelga (espera input, pega a la red) no puede dejar la app sin abrir.
        let deadline = Instant::now() + Duration::from_secs(3);
        while Instant::now() < deadline {
            if let Ok(Some(_)) = child.try_wait() {
                break;
            }
            std::thread::sleep(Duration::from_millis(25));
        }
        let _ = child.kill();
        if let Ok(out) = child.wait_with_output() {
            // Entre marcas: un rc puede imprimir su propio cartel antes.
            let text = String::from_utf8_lossy(&out.stdout);
            from_shell = text.split(MARK).nth(1).filter(|p| !p.is_empty()).map(str::to_owned);
        }
    }

    let current = std::env::var_os("PATH").unwrap_or_default();
    let mut dirs: Vec<PathBuf> = from_shell.map(|p| std::env::split_paths(&p).collect()).unwrap_or_default();
    // Lo que ya tenia el proceso va despues, y `~/.local/bin` siempre: es donde queda `ldt`.
    dirs.extend(std::env::split_paths(&current));
    if let Some(home) = std::env::var_os("HOME") {
        dirs.push(Path::new(&home).join(".local/bin"));
    }
    let mut seen = std::collections::HashSet::new();
    dirs.retain(|d| seen.insert(d.clone()));
    if let Ok(joined) = std::env::join_paths(dirs) {
        // SAFETY: corre al principio de `run`, antes de que Tauri levante un solo thread.
        unsafe { std::env::set_var("PATH", joined) };
    }
}

/// `ldt.py` a partir del shim que esta en el PATH (`<repo>/bin/ldt`), o de `LDT_PY`.
///
/// En Linux y macOS el shim del PATH es un symlink (`~/.local/bin/ldt` -> `<repo>/bin/ldt`):
/// hay que resolverlo, porque `ldt.py` esta al lado del archivo real y no del link.
fn find_ldt() -> Result<PathBuf, String> {
    if let Some(script) = std::env::var_os("LDT_PY") {
        return Ok(script.into());
    }
    let path = std::env::var_os("PATH").unwrap_or_default();
    for dir in std::env::split_paths(&path) {
        let shim = dir.join("ldt");
        if !shim.exists() {
            continue;
        }
        // En Windows no hace falta, y canonicalize devolveria una ruta `\\?\D:\...`.
        #[cfg(not(windows))]
        let shim = std::fs::canonicalize(&shim).unwrap_or(shim);
        if let Some(script) = shim.parent().and_then(Path::parent).map(|repo| repo.join("ldt.py"))
            && script.exists()
        {
            return Ok(script);
        }
    }
    Err("no encontre ldt: ponelo en el PATH o defini LDT_PY=/ruta/a/ldt.py".into())
}

fn python() -> String {
    std::env::var("LDT_PYTHON").unwrap_or_else(|_| (if cfg!(windows) { "python" } else { "python3" }).into())
}

fn run_ldt(args: Vec<String>) -> Envelope {
    let script = match find_ldt() {
        Ok(s) => s,
        Err(e) => return Envelope::err(e),
    };
    let output = hidden(
        Command::new(python())
            .arg(&script)
            .args(&args)
            .arg("--json")
            .stdin(Stdio::null()),
    )
    .output();
    let out = match output {
        Ok(o) => o,
        Err(e) => return Envelope::err(format!("no pude ejecutar {}: {e}", python())),
    };
    // Aun fallando puede haber JSON (un `dev start` que murio al arrancar trae su log).
    let data = serde_json::from_slice(&out.stdout).unwrap_or(Value::Null);
    if out.status.success() {
        return Envelope { ok: true, data, error: None };
    }
    let stderr = String::from_utf8_lossy(&out.stderr);
    let msg = stderr.trim().trim_start_matches("error:").trim();
    let error = if msg.is_empty() { format!("ldt salio con {}", out.status) } else { msg.to_string() };
    Envelope { ok: false, data, error: Some(error) }
}

/// Todo lo que lanza procesos o toca disco va fuera del hilo de la UI.
async fn blocking(f: impl FnOnce() -> Envelope + Send + 'static) -> Envelope {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .unwrap_or_else(|e| Envelope::err(e.to_string()))
}

fn is_dir(p: &str) -> bool {
    let path = Path::new(p);
    path.is_absolute() && path.is_dir()
}

#[tauri::command]
async fn scan(root: String) -> Envelope {
    if !is_dir(&root) {
        return Envelope::err("la carpeta no existe");
    }
    blocking(move || run_ldt(vec!["scan".into(), "--all".into(), root])).await
}

#[tauri::command]
async fn list() -> Envelope {
    blocking(|| run_ldt(vec!["dev".into(), "list".into()])).await
}

#[tauri::command]
async fn start(cwd: String, port: Option<u16>, restart: Option<bool>) -> Envelope {
    if !is_dir(&cwd) {
        return Envelope::err("la carpeta no existe");
    }
    let mut args: Vec<String> = vec!["--cwd".into(), cwd, "dev".into(), "start".into(), "--settle".into(), "0".into()];
    if let Some(port) = port {
        args.extend(["--port".into(), port.to_string()]);
    }
    if restart == Some(true) {
        args.push("--restart".into());
    }
    blocking(move || run_ldt(args)).await
}

#[tauri::command]
async fn stop(name: String) -> Envelope {
    let valid = !name.is_empty() && name.chars().all(|c| c.is_ascii_alphanumeric() || "_.@-".contains(c));
    if !valid {
        return Envelope::err("nombre invalido");
    }
    blocking(move || run_ldt(vec!["dev".into(), "stop".into(), name])).await
}

fn read_log_impl(path: &str, offset: i64) -> Result<Value, String> {
    // canonicalize antes de mirar el nombre: un `logs/../otra.log` no pasa.
    let file = std::fs::canonicalize(path).map_err(|e| e.to_string())?;
    let in_logs = file.extension().is_some_and(|e| e == "log")
        && file.parent().and_then(Path::file_name).is_some_and(|n| n == "logs");
    if !in_logs {
        return Err("solo se leen logs de ldt".into());
    }
    let mut fh = File::open(&file).map_err(|e| e.to_string())?;
    let size = fh.metadata().map_err(|e| e.to_string())?.len();
    // -1 = primera lectura: solo la cola. Un archivo mas chico que el offset se trunco
    // (un `dev start` nuevo lo vacia), y hay que volver a empezar.
    let (start, reset) = if offset < 0 || offset as u64 > size {
        (size.saturating_sub(64 * 1024), true)
    } else {
        (offset as u64, false)
    };
    let len = (size - start).min(256 * 1024) as usize;
    let mut buf = vec![0; len];
    fh.seek(SeekFrom::Start(start)).map_err(|e| e.to_string())?;
    fh.read_exact(&mut buf).map_err(|e| e.to_string())?;
    // Un corte a mitad de un caracter multibyte se deja para la proxima lectura, en vez
    // de mandar un reemplazo y perder el caracter.
    if let Err(e) = std::str::from_utf8(&buf)
        && e.error_len().is_none()
    {
        buf.truncate(e.valid_up_to());
    }
    let read = buf.len() as u64;
    Ok(json!({ "text": String::from_utf8_lossy(&buf), "offset": start + read, "reset": reset }))
}

#[tauri::command]
async fn read_log(path: String, offset: i64) -> Envelope {
    blocking(move || Envelope::from(read_log_impl(&path, offset))).await
}

fn spawn(cmd: &mut Command) -> Result<(), String> {
    try_spawn(cmd).map_err(|e| e.to_string())
}

fn try_spawn(cmd: &mut Command) -> std::io::Result<()> {
    cmd.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    cmd.spawn().map(|_| ())
}

/// Linux no tiene una terminal por defecto: `x-terminal-emulator` es de Debian/Ubuntu. Se
/// prueba `$TERMINAL`, esa, y las de los escritorios mas comunes, todas con la carpeta como
/// cwd, hasta que una exista.
#[cfg(all(not(windows), not(target_os = "macos")))]
fn spawn_linux_terminal(dir: &str) -> Result<(), String> {
    const KNOWN: [&str; 9] = [
        "x-terminal-emulator",
        "gnome-terminal",
        "konsole",
        "xfce4-terminal",
        "kitty",
        "alacritty",
        "wezterm",
        "foot",
        "xterm",
    ];
    let custom = std::env::var("TERMINAL").ok().filter(|t| !t.trim().is_empty());
    for term in custom.iter().map(String::as_str).chain(KNOWN) {
        match try_spawn(Command::new(term).current_dir(dir)) {
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => continue,
            other => return other.map_err(|e| e.to_string()),
        }
    }
    Err("no encontre una terminal: defini TERMINAL con la que uses".into())
}

fn open_impl(kind: &str, target: &str) -> Result<Value, String> {
    match kind {
        "url" => {
            let valid = (target.starts_with("http://") || target.starts_with("https://"))
                && !target.contains(|c: char| c.is_whitespace() || c == '"');
            if !valid {
                return Err("url invalida".into());
            }
            // rundll32 en vez de `cmd /c start`: la URL no pasa por el parser de cmd, donde
            // un `&` de la query string cortaria el comando.
            if cfg!(windows) {
                spawn(Command::new("rundll32.exe").args(["url.dll,FileProtocolHandler", target]))?
            } else if cfg!(target_os = "macos") {
                spawn(Command::new("open").arg(target))?
            } else {
                spawn(Command::new("xdg-open").arg(target))?
            }
        }
        "folder" | "terminal" | "editor" if !is_dir(target) => return Err("no existe la carpeta".into()),
        "folder" => {
            if cfg!(windows) {
                spawn(Command::new("explorer.exe").arg(target))?
            } else if cfg!(target_os = "macos") {
                spawn(Command::new("open").arg(target))?
            } else {
                spawn(Command::new("xdg-open").arg(target))?
            }
        }
        "terminal" => {
            // La carpeta va como cwd, no como argumento: asi no hay que citarla para cmd.
            // El cmd de afuera va oculto; `start` le abre su propia consola al de adentro.
            #[cfg(windows)]
            spawn(hidden(Command::new("cmd.exe").args(["/c", "start", "cmd.exe"]).current_dir(target)))?;
            #[cfg(target_os = "macos")]
            spawn(Command::new("open").args(["-a", "Terminal", target]))?;
            #[cfg(all(not(windows), not(target_os = "macos")))]
            spawn_linux_terminal(target)?;
        }
        "editor" => {
            // `code` en Windows es un .cmd y tiene que pasar por cmd: por eso `code .` con la
            // carpeta como cwd, igual que la terminal, y no la ruta como argumento.
            // En macOS `code` solo existe si se lo instalo desde VS Code ("Shell Command:
            // Install 'code' command in PATH"); si no esta, se abre la app por su nombre.
            if cfg!(windows) {
                spawn(hidden(Command::new("cmd.exe").args(["/c", "code", "."]).current_dir(target)))?
            } else {
                match try_spawn(Command::new("code").arg(".").current_dir(target)) {
                    Err(e) if e.kind() == std::io::ErrorKind::NotFound && cfg!(target_os = "macos") => {
                        spawn(Command::new("open").args(["-a", "Visual Studio Code", target]))?
                    }
                    other => other.map_err(|e| e.to_string())?,
                }
            }
        }
        other => return Err(format!("no se abrir \"{other}\"")),
    }
    Ok(Value::Null)
}

#[tauri::command]
async fn open(kind: String, target: String) -> Envelope {
    blocking(move || Envelope::from(open_impl(&kind, &target))).await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(not(windows))]
    adopt_login_path();

    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![scan, list, start, stop, read_log, open])
        .run(tauri::generate_context!())
        .expect("no pude arrancar la app");
}
