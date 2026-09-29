fn main() {
    // tauri-build le pide a Cargo que vigile tauri.conf.json y capabilities/, pero no
    // icons/: sin esto, cambiar el icono no vuelve a correr este script y el .exe (y los
    // instaladores) salen con el icono anterior embebido.
    println!("cargo:rerun-if-changed=icons");
    tauri_build::build()
}
