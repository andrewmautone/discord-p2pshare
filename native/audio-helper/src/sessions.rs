//! Lista os processos que têm sessão de áudio ativa.
//!
//! Sem isto não há de onde escolher um app: o plugin precisa mostrar uma
//! lista, e quem sabe quais processos estão tocando som é o Windows.

use windows::core::Interface;
use windows::Win32::Foundation::{CloseHandle, MAX_PATH};
use windows::Win32::Media::Audio::{
    eConsole, eRender, IAudioSessionControl2, IAudioSessionManager2, IMMDeviceEnumerator,
    MMDeviceEnumerator,
};
use windows::Win32::System::Com::{CoCreateInstance, CLSCTX_ALL};
use windows::Win32::System::Threading::{
    OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_FORMAT,
    PROCESS_QUERY_LIMITED_INFORMATION,
};

/// Nome do executável de um PID, sem o caminho.
///
/// Processos protegidos negam abertura; nesse caso o PID sozinho já serve
/// para o usuário reconhecer pouca coisa, mas é melhor que sumir da lista.
fn process_name(pid: u32) -> String {
    unsafe {
        let Ok(handle) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) else {
            return format!("pid {pid}");
        };

        let mut buf = [0u16; MAX_PATH as usize];
        let mut len = buf.len() as u32;

        let ok = QueryFullProcessImageNameW(
            handle,
            PROCESS_NAME_FORMAT(0),
            windows::core::PWSTR(buf.as_mut_ptr()),
            &mut len,
        );

        let _ = CloseHandle(handle);

        if ok.is_err() || len == 0 {
            return format!("pid {pid}");
        }

        let full = String::from_utf16_lossy(&buf[..len as usize]);
        full.rsplit('\\').next().unwrap_or(&full).to_string()
    }
}

fn escape_json(text: &str) -> String {
    text.replace('\\', "\\\\").replace('"', "\\\"")
}

/// Imprime no stdout o que `list_json` monta. Só o modo de linha de comando.
pub fn list() -> windows::core::Result<()> {
    println!("{}", list_json()?);
    Ok(())
}

/// Monta `[{"pid":123,"name":"jogo.exe"}, ...]`.
pub fn list_json() -> windows::core::Result<String> {
    let mut seen: Vec<(u32, String)> = Vec::new();

    unsafe {
        let enumerator: IMMDeviceEnumerator =
            CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
        let device = enumerator.GetDefaultAudioEndpoint(eRender, eConsole)?;

        let manager: IAudioSessionManager2 = device.Activate(CLSCTX_ALL, None)?;
        let sessions = manager.GetSessionEnumerator()?;

        for i in 0..sessions.GetCount()? {
            let Ok(control) = sessions.GetSession(i) else {
                continue;
            };
            let Ok(control2) = control.cast::<IAudioSessionControl2>() else {
                continue;
            };
            let Ok(pid) = control2.GetProcessId() else {
                continue;
            };

            // pid 0 é o mixer do próprio sistema, não um app.
            if pid == 0 || seen.iter().any(|(p, _)| *p == pid) {
                continue;
            }

            seen.push((pid, process_name(pid)));
        }
    }

    seen.sort_by(|a, b| a.1.to_lowercase().cmp(&b.1.to_lowercase()));

    let items: Vec<String> = seen
        .iter()
        .map(|(pid, name)| format!("{{\"pid\":{},\"name\":\"{}\"}}", pid, escape_json(name)))
        .collect();

    Ok(format!("[{}]", items.join(",")))
}
