// Sin consola extra en Windows en release. NO SACAR.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    ldt_ui_lib::run();
}
