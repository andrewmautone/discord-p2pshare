//! Serve o áudio por HTTP em 127.0.0.1, em vez de escrever no stdout.
//!
//! O stdout deixou de ser alcançável. Iniciar este programa a partir do
//! plugin exigia `child_process`, que o BetterDiscord não entrega, e a via
//! alternativa — as ligações internas do Node — derruba o Discord: no Node 24
//! elas abortam o processo em vez de lançar exceção.
//!
//! O que sobrou foi `shell.openPath`, que inicia um programa mas não passa
//! argumentos nem dá acesso ao stdout. Daí este servidor: o plugin fala com
//! ele por HTTP, que a política de conteúdo do Discord libera em 127.0.0.1 —
//! medido, inclusive com leitura incremental, que é o que áudio contínuo
//! exige.
//!
//! Como não há argumentos, o modo de captura viaja na URL. O que não pode
//! viajar na URL é a permissão: qualquer programa local poderia pedir o áudio
//! da máquina. Por isso o plugin sorteia um segredo, grava num arquivo ao lado
//! do executável, e sem ele o servidor recusa.

use std::io::{BufRead, BufReader, Write};
use std::net::{Ipv4Addr, SocketAddr, TcpListener, TcpStream};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use crate::{capture_to, log_fatal, Scope};

/// Sai sozinho depois deste tempo sem ninguém conectado.
///
/// Sem isto um plugin que fecha mal deixaria o processo vivo capturando áudio
/// para sempre — invisível, porque não há janela.
const IDLE_TIMEOUT: Duration = Duration::from_secs(45);

/// Arquivos ao lado do executável: o segredo entra, a porta sai.
fn beside_exe(name: &str) -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    Some(exe.parent()?.join(name))
}

fn read_token() -> Option<String> {
    let path = beside_exe("p2pshare-audio.token")?;
    let raw = std::fs::read_to_string(path).ok()?;
    let token = raw.trim().to_string();

    // Segredo curto demais não é segredo. O plugin gera 32 hex.
    if token.len() < 16 {
        return None;
    }
    Some(token)
}

/// Um parâmetro da query string, sem depender de crate de URL.
fn param<'a>(query: &'a str, key: &str) -> Option<&'a str> {
    query.split('&').find_map(|pair| {
        let (k, v) = pair.split_once('=')?;
        (k == key).then_some(v)
    })
}

fn respond(stream: &mut TcpStream, status: &str, body: &str) {
    let _ = write!(
        stream,
        "HTTP/1.1 {status}\r\n\
         Content-Type: application/json; charset=utf-8\r\n\
         Content-Length: {}\r\n\
         Access-Control-Allow-Origin: *\r\n\
         Cache-Control: no-store\r\n\
         Connection: close\r\n\r\n{body}",
        body.len()
    );
}

/// Cabeçalho de uma resposta que não tem tamanho conhecido.
///
/// Sem `Content-Length` o navegador entrega os pedaços conforme chegam e
/// encerra quando a conexão fecha — que é o comportamento desejado para um
/// fluxo de áudio que só termina quando alguém desiste dele.
fn respond_stream_header(stream: &mut TcpStream) -> std::io::Result<()> {
    write!(
        stream,
        "HTTP/1.1 200 OK\r\n\
         Content-Type: application/octet-stream\r\n\
         Access-Control-Allow-Origin: *\r\n\
         Cache-Control: no-store\r\n\
         Connection: close\r\n\r\n"
    )
}

/// Modo de captura pedido na URL.
fn scope_from(query: &str) -> Option<(u32, Scope)> {
    let mode = param(query, "mode")?;
    let target: u64 = param(query, "target")?.parse().ok()?;

    match mode {
        "exclude" => Some((target as u32, Scope::Exclude)),
        "include" => Some((target as u32, Scope::Include)),
        // A janela chega como handle; quem sabe o dono dela é o Windows.
        "window" => crate::window_owner(target as isize).map(|pid| (pid, Scope::Include)),
        _ => None,
    }
}

fn handle(mut stream: TcpStream, token: &str, busy: &Arc<AtomicU64>) {
    // Uma requisição por conexão, e a linha de pedido basta: não há corpo
    // nem cabeçalho que interesse aqui.
    let mut line = String::new();
    let mut reader = BufReader::new(match stream.try_clone() {
        Ok(s) => s,
        Err(_) => return,
    });

    if reader.read_line(&mut line).is_err() {
        return;
    }

    let mut parts = line.split_whitespace();
    let method = parts.next().unwrap_or("");
    let target = parts.next().unwrap_or("");

    if method != "GET" {
        respond(&mut stream, "405 Method Not Allowed", "{\"erro\":\"use GET\"}");
        return;
    }

    let (path, query) = target.split_once('?').unwrap_or((target, ""));

    if param(query, "token") != Some(token) {
        respond(&mut stream, "403 Forbidden", "{\"erro\":\"segredo invalido\"}");
        return;
    }

    match path {
        "/apps" => match crate::sessions::list_json() {
            Ok(json) => respond(&mut stream, "200 OK", &json),
            Err(err) => respond(
                &mut stream,
                "500 Internal Server Error",
                &format!("{{\"erro\":\"{err}\"}}"),
            ),
        },

        "/pcm" => {
            let Some((pid, scope)) = scope_from(query) else {
                respond(&mut stream, "400 Bad Request", "{\"erro\":\"modo invalido\"}");
                return;
            };

            if respond_stream_header(&mut stream).is_err() {
                return;
            }

            // Enquanto alguém escuta, o processo não é ocioso.
            busy.fetch_add(1, Ordering::SeqCst);

            // A captura termina sozinha quando a escrita falha, que é como um
            // navegador comunica que fechou a aba ou parou a transmissão.
            if let Err(err) = capture_to(&mut stream, pid, scope) {
                log_fatal(&format!("captura interrompida: {err}"));
            }

            busy.fetch_sub(1, Ordering::SeqCst);
        }

        // Barato de propósito: o plugin usa isto para saber se o processo
        // que a porta anuncia ainda é este, sem acordar o COM.
        "/ping" => respond(&mut stream, "200 OK", "{\"ok\":true}"),

        "/parar" => {
            respond(&mut stream, "200 OK", "{\"ok\":true}");
            let _ = stream.flush();
            std::process::exit(0);
        }

        _ => respond(&mut stream, "404 Not Found", "{\"erro\":\"rota desconhecida\"}"),
    }
}

pub fn serve() {
    let Some(token) = read_token() else {
        log_fatal("sem segredo ao lado do executavel; nada a servir");
        std::process::exit(2);
    };

    // Porta efêmera: fixar uma significaria colidir com o que já estivesse
    // ouvindo, e o plugin descobre qual foi pelo arquivo abaixo.
    let listener = match TcpListener::bind(SocketAddr::from((Ipv4Addr::LOCALHOST, 0))) {
        Ok(l) => l,
        Err(err) => {
            log_fatal(&format!("nao deu para abrir porta local: {err}"));
            std::process::exit(1);
        }
    };

    let port = match listener.local_addr() {
        Ok(addr) => addr.port(),
        Err(err) => {
            log_fatal(&format!("porta sem endereco: {err}"));
            std::process::exit(1);
        }
    };

    if let Some(path) = beside_exe("p2pshare-audio.port") {
        if let Err(err) = std::fs::write(&path, port.to_string()) {
            log_fatal(&format!("nao deu para anunciar a porta: {err}"));
            std::process::exit(1);
        }
    }

    let busy = Arc::new(AtomicU64::new(0));

    // Vigia de ociosidade: sem janela, um processo esquecido capturando áudio
    // não teria como ser notado.
    {
        let busy = Arc::clone(&busy);
        let started = Instant::now();
        let last_seen = Arc::new(std::sync::Mutex::new(started));
        let seen = Arc::clone(&last_seen);

        std::thread::spawn(move || loop {
            std::thread::sleep(Duration::from_secs(5));

            if busy.load(Ordering::SeqCst) > 0 {
                *seen.lock().unwrap() = Instant::now();
                continue;
            }

            if seen.lock().unwrap().elapsed() > IDLE_TIMEOUT {
                std::process::exit(0);
            }
        });
    }

    for incoming in listener.incoming() {
        let Ok(stream) = incoming else { continue };

        let token = token.clone();
        let busy = Arc::clone(&busy);

        // Uma thread por conexão: listar aplicativos não pode ficar preso
        // atrás de uma captura em andamento.
        std::thread::spawn(move || {
            unsafe {
                use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};
                let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
            }
            handle(stream, &token, &busy);
        });
    }
}
