//! Captura o áudio do sistema excluindo a árvore de um processo.
//!
//! Existe por um motivo só: o Chromium não expõe captura de áudio por
//! processo. O `getUserMedia` com `chromeMediaSource: "desktop"` traz o
//! loopback da máquina inteira, o Discord junto — e quem assiste ouve a
//! própria chamada de volta.
//!
//! O Windows 10 2004+ resolve isso com `ActivateAudioInterfaceAsync` e
//! `AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK`, que aceita excluir uma
//! árvore de processos. Passando o PID do Discord, sai tudo menos ele.
//!
//! Sem argumento nenhum ele sobe um servidor HTTP em 127.0.0.1 e serve o
//! áudio por ali — é assim que o plugin o usa, porque `shell.openPath`, o
//! único jeito de iniciar um programa a partir do BetterDiscord, não passa
//! argumentos nem dá acesso ao stdout. Veja `serve.rs`.
//!
//! Os modos de linha de comando continuam, para uso direto e para teste:
//!     p2pshare-audio.exe --exclude <pid>   tudo menos a arvore desse processo
//!     p2pshare-audio.exe --include <pid>   apenas a arvore desse processo
//!     p2pshare-audio.exe --include-window <hwnd>  o dono daquela janela
//!     p2pshare-audio.exe --list            processos com audio ativo, em JSON
//!
//! Em qualquer modo o PCM é o mesmo: float32 little-endian, 48 kHz, estéreo.

// Sem console: o programa é iniciado pelo plugin e não tem nada a mostrar.
// Uma janela preta piscando a cada transmissão seria só susto.
#![windows_subsystem = "windows"]

mod serve;
mod sessions;

use std::io::Write;
use std::sync::mpsc::{channel, Sender};

use windows::core::{implement, Interface, Result, HRESULT, PCWSTR, PROPVARIANT};
use windows::Win32::Foundation::{CloseHandle, HANDLE, S_OK, WAIT_OBJECT_0};
use windows::Win32::Media::Audio::{
    ActivateAudioInterfaceAsync, IActivateAudioInterfaceAsyncOperation,
    IActivateAudioInterfaceCompletionHandler, IActivateAudioInterfaceCompletionHandler_Impl,
    IAudioCaptureClient, IAudioClient, AUDCLNT_SHAREMODE_SHARED,
    AUDCLNT_STREAMFLAGS_EVENTCALLBACK, AUDCLNT_STREAMFLAGS_LOOPBACK,
    AUDIOCLIENT_ACTIVATION_PARAMS, AUDIOCLIENT_ACTIVATION_PARAMS_0,
    AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK, AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS,
    PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE,
    PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE, VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK,
    WAVEFORMATEX, WAVEFORMATEXTENSIBLE,
};
use windows::Win32::Media::KernelStreaming::WAVE_FORMAT_EXTENSIBLE;
use windows::Win32::Media::Multimedia::KSDATAFORMAT_SUBTYPE_IEEE_FLOAT;
use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};
use windows::Win32::System::Threading::{CreateEventW, WaitForSingleObject};
use windows::Win32::UI::WindowsAndMessaging::GetWindowThreadProcessId;

const SAMPLE_RATE: u32 = 48_000;
const CHANNELS: u16 = 2;
const BITS: u16 = 32;

/// Buffer de 200 ms, em unidades de 100 ns.
const BUFFER_DURATION: i64 = 200 * 10_000;

/// O buffer veio marcado como silêncio e o conteúdo não presta.
const AUDCLNT_BUFFERFLAGS_SILENT: u32 = 0x2;

const VT_BLOB: u16 = 65;

/// PROPVARIANT carregando um blob, montado à mão.
///
/// O wrapper seguro do crate não expõe construção de blob, e é assim que a
/// API de ativação espera receber os parâmetros. Layout idêntico ao
/// PROPVARIANT do Windows em 64 bits: 8 bytes de cabeçalho e 16 de união.
#[repr(C)]
struct BlobPropVariant {
    vt: u16,
    reserved1: u16,
    reserved2: u16,
    reserved3: u16,
    cb_size: u32,
    _padding: u32,
    blob: *mut u8,
}

/// Recebe o aviso de que a ativação assíncrona terminou.
///
/// `ActivateAudioInterfaceAsync` não devolve o cliente direto: ela chama de
/// volta neste objeto, e só então o resultado pode ser lido da operação.
#[implement(IActivateAudioInterfaceCompletionHandler)]
struct ActivationHandler {
    done: Sender<()>,
}

impl IActivateAudioInterfaceCompletionHandler_Impl for ActivationHandler_Impl {
    fn ActivateCompleted(
        &self,
        _operation: Option<&IActivateAudioInterfaceAsyncOperation>,
    ) -> Result<()> {
        let _ = self.done.send(());
        Ok(())
    }
}

/// Formato pedido ao Windows: float32 48 kHz estéreo.
///
/// No modo process loopback o cliente não negocia formato com o dispositivo;
/// quem define é quem captura, e float32 evita conversão do lado do plugin.
fn wave_format() -> WAVEFORMATEXTENSIBLE {
    let block_align = CHANNELS * BITS / 8;

    let mut fmt = WAVEFORMATEXTENSIBLE::default();
    fmt.Format = WAVEFORMATEX {
        wFormatTag: WAVE_FORMAT_EXTENSIBLE as u16,
        nChannels: CHANNELS,
        nSamplesPerSec: SAMPLE_RATE,
        nAvgBytesPerSec: SAMPLE_RATE * block_align as u32,
        nBlockAlign: block_align,
        wBitsPerSample: BITS,
        cbSize: (std::mem::size_of::<WAVEFORMATEXTENSIBLE>()
            - std::mem::size_of::<WAVEFORMATEX>()) as u16,
    };
    fmt.Samples.wValidBitsPerSample = BITS;
    // Frente esquerda + frente direita.
    fmt.dwChannelMask = 0x3;
    fmt.SubFormat = KSDATAFORMAT_SUBTYPE_IEEE_FLOAT;
    fmt
}

/// Processo dono de uma janela.
///
/// O seletor de tela devolve a janela, nao o processo. Resolver aqui evita
/// que o plugin precise de mais uma chamada nativa so' para isso.
pub fn window_owner(hwnd: isize) -> Option<u32> {
    let mut pid = 0u32;
    let thread = unsafe {
        GetWindowThreadProcessId(
            windows::Win32::Foundation::HWND(hwnd as *mut core::ffi::c_void),
            Some(&mut pid),
        )
    };

    if thread == 0 || pid == 0 {
        return None;
    }
    Some(pid)
}

/// Quem entra na captura: só o processo indicado, ou todo o resto.
#[derive(Clone, Copy)]
pub enum Scope {
    Include,
    Exclude,
}

fn activate_client(target_pid: u32, scope: Scope) -> Result<IAudioClient> {
    let mut params = AUDIOCLIENT_ACTIVATION_PARAMS {
        ActivationType: AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK,
        Anonymous: AUDIOCLIENT_ACTIVATION_PARAMS_0 {
            ProcessLoopbackParams: AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS {
                TargetProcessId: target_pid,
                ProcessLoopbackMode: match scope {
                    Scope::Include => PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE,
                    Scope::Exclude => PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE,
                },
            },
        },
    };

    let blob = BlobPropVariant {
        vt: VT_BLOB,
        reserved1: 0,
        reserved2: 0,
        reserved3: 0,
        cb_size: std::mem::size_of::<AUDIOCLIENT_ACTIVATION_PARAMS>() as u32,
        _padding: 0,
        blob: &mut params as *mut _ as *mut u8,
    };

    let (tx, rx) = channel();
    let handler: IActivateAudioInterfaceCompletionHandler =
        ActivationHandler { done: tx }.into();

    let operation: IActivateAudioInterfaceAsyncOperation = unsafe {
        ActivateAudioInterfaceAsync(
            PCWSTR(VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK.as_ptr()),
            &IAudioClient::IID,
            Some(&blob as *const _ as *const PROPVARIANT),
            &handler,
        )?
    };

    // A chamada é assíncrona: sem esperar, o resultado ainda não existe.
    rx.recv().expect("ativação nunca completou");

    let mut hr = HRESULT(0);
    let mut client: Option<windows::core::IUnknown> = None;
    unsafe { operation.GetActivateResult(&mut hr, &mut client)? };

    if hr != S_OK {
        return Err(windows::core::Error::from(hr));
    }

    client
        .expect("ativação completou sem devolver cliente")
        .cast::<IAudioClient>()
}

/// Registra uma falha ao lado do executável.
///
/// Sem console não há stderr para ler. Um arquivo é o único jeito de saber
/// por que o auxiliar desistiu, e o plugin sabe onde procurar.
pub fn log_fatal(message: &str) {
    let Ok(exe) = std::env::current_exe() else {
        return;
    };
    let Some(dir) = exe.parent() else { return };

    let _ = std::fs::write(dir.join("p2pshare-audio.log"), message);
}

/// Captura e escreve o PCM no destino, até ele parar de aceitar.
///
/// O destino ser genérico é o que permite servir tanto o stdout do modo de
/// linha de comando quanto uma conexão HTTP: a captura não precisa saber a
/// diferença, e quem desiste primeiro é sempre quem lê.
pub fn capture_to<W: Write>(sink: &mut W, target_pid: u32, scope: Scope) -> Result<()> {
    unsafe { CoInitializeEx(None, COINIT_MULTITHREADED).ok()? };

    let client = activate_client(target_pid, scope)?;
    let format = wave_format();

    unsafe {
        client.Initialize(
            AUDCLNT_SHAREMODE_SHARED,
            AUDCLNT_STREAMFLAGS_LOOPBACK | AUDCLNT_STREAMFLAGS_EVENTCALLBACK,
            BUFFER_DURATION,
            0,
            &format.Format,
            None,
        )?;
    }

    let event: HANDLE = unsafe { CreateEventW(None, false, false, PCWSTR::null())? };
    unsafe { client.SetEventHandle(event)? };

    let capture: IAudioCaptureClient = unsafe { client.GetService()? };
    unsafe { client.Start()? };

    let frame_size = (CHANNELS * BITS / 8) as usize;

    loop {
        // O evento avisa que há bloco pronto; sem ele seria polling ocupado.
        if unsafe { WaitForSingleObject(event, 2000) } != WAIT_OBJECT_0 {
            continue;
        }

        loop {
            let mut frames = 0u32;
            let mut data: *mut u8 = std::ptr::null_mut();
            let mut flags = 0u32;

            let got = unsafe {
                capture.GetBuffer(&mut data, &mut frames, &mut flags, None, None)
            };
            if got.is_err() {
                break;
            }

            if frames == 0 {
                unsafe {
                    let _ = capture.ReleaseBuffer(0);
                }
                break;
            }

            let bytes = frames as usize * frame_size;

            // Silêncio vem sinalizado com o buffer sujo; mandar zeros mantém o
            // fluxo contínuo, que é o que o lado do WebRTC espera.
            let written = if flags & AUDCLNT_BUFFERFLAGS_SILENT != 0 {
                sink.write_all(&vec![0u8; bytes])
            } else {
                let slice = unsafe { std::slice::from_raw_parts(data, bytes) };
                sink.write_all(slice)
            };

            unsafe {
                let _ = capture.ReleaseBuffer(frames);
            }

            // Quem lê desistiu — aba fechada, transmissão parada, cano
            // rompido. Numa conexão de rede isso chega como erro qualquer,
            // não só BrokenPipe, e insistir só queimaria CPU capturando para
            // ninguém.
            if written.is_err() {
                unsafe {
                    let _ = client.Stop();
                    let _ = CloseHandle(event);
                }
                return Ok(());
            }
        }
    }
}

fn main() {
    let args: Vec<String> = std::env::args().collect();

    // Iniciado pelo plugin, que nao tem como passar argumentos: sobe o
    // servidor local e espera o pedido de captura chegar por HTTP.
    if args.len() <= 1 {
        serve::serve();
        return;
    }

    if args.iter().any(|a| a == "--list") {
        unsafe {
            if CoInitializeEx(None, COINIT_MULTITHREADED).ok().is_err() {
                eprintln!("[p2pshare-audio] nao deu para iniciar o COM");
                std::process::exit(1);
            }
        }

        if let Err(err) = sessions::list() {
            eprintln!("[p2pshare-audio] erro ao listar: {err}");
            std::process::exit(1);
        }
        return;
    }

    let target = args.windows(2).find_map(|w| match w[0].as_str() {
        "--include" => w[1].parse::<u32>().ok().map(|pid| (pid, Scope::Include)),
        "--exclude" => w[1].parse::<u32>().ok().map(|pid| (pid, Scope::Exclude)),
        "--include-window" => w[1]
            .parse::<isize>()
            .ok()
            .and_then(window_owner)
            .map(|pid| (pid, Scope::Include)),
        _ => None,
    });

    let Some((pid, scope)) = target else {
        eprintln!(
            "uso: p2pshare-audio.exe [--exclude <pid> | --include <pid> | \
             --include-window <hwnd> | --list]"
        );
        std::process::exit(2);
    };

    let mut stdout = std::io::stdout();
    if let Err(err) = capture_to(&mut stdout, pid, scope) {
        log_fatal(&format!("erro na captura: {err}"));
        std::process::exit(1);
    }
}
