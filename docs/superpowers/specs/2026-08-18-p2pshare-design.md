# P2PShare — compartilhamento de tela P2P no Discord

**Data:** 2026-08-18
**Status:** design aprovado, pendente revisão do spec

## Objetivo

Plugin Vencord que permite compartilhar a tela para todos os membros de um canal
de voz via WebRTC ponto-a-ponto, sem passar pela infra de vídeo do Discord e sem
servidor próprio. A sinalização (troca de SDP/ICE) trafega por mensagens do
próprio canal.

Motivação: o screenshare nativo tem teto de qualidade e bitrate imposto pelo
servidor. P2P direto não tem cap e tem latência menor.

## Não-objetivos

- SFU / servidor de mídia próprio.
- TURN. Pares atrás de NAT simétrico (CGNAT) simplesmente não conectam e recebem
  uma mensagem de erro explicando o motivo.
- Gravação, streaming para fora do Discord, ou compartilhamento com quem não tem
  o plugin.
- Substituir o screenshare nativo. Os dois coexistem.

## Arquitetura

Topologia **mesh**: o broadcaster mantém uma `RTCPeerConnection` por viewer.
Todas as conexões enviam a mesma `MediaStreamTrack`, então o Chromium reaproveita
um único encoder — só a banda de upload escala linearmente, não a CPU.

```
                    ┌──────────────┐
                    │ Broadcaster  │
                    └──┬────┬────┬─┘
              ┌────────┘    │    └────────┐
              ▼             ▼             ▼
         ┌────────┐    ┌────────┐    ┌────────┐
         │Viewer A│    │Viewer B│    │Viewer C│
         └────────┘    └────────┘    └────────┘

     sinalização (offer/answer) ──► chat do canal de voz
     mídia ─────────────────────► direto, peer-to-peer
```

Teto prático: ~6 viewers. Acima disso o upload do broadcaster satura e a
qualidade por viewer cai abaixo do útil.

### Servidores STUN

Públicos, só para descoberta de candidatos:

```
stun:stun.l.google.com:19302
stun:stun.cloudflare.com:3478
```

## Protocolo de sinalização

Duas categorias de mensagem, ambas no chat do canal de voz onde a transmissão
acontece.

### Beacon

Postado pelo broadcaster ao iniciar, deletado ao parar. Fica visível durante toda
a transmissão. O conteúdo é legível por humanos — quem não tem o plugin lê a
mensagem normal e o link de instalação:

```
🔴 **Andrew** está transmitindo a tela via P2P.
Instale o plugin para assistir: <url do repo>
```

Carrega junto um payload invisível codificado em caracteres zero-width, anexado
ao fim do texto:

```jsonc
{ "v": 1, "s": "<sessionId>" }   // ~24 bytes → ~96 chars zero-width
```

`sessionId` é um id curto aleatório (8 chars). O autor da mensagem identifica o
broadcaster, então não vai no payload.

Clientes com o plugin renderizam um botão **Assistir** no lugar do texto.

**Codificação zero-width:** 2 bits por caractere usando quatro code points
invisíveis (`U+200B`, `U+200C`, `U+200D`, `U+2060`), delimitados por `U+2062`.
Só o beacon usa isso — o payload é minúsculo e cabe folgado no limite de 2000
chars.

### Handshake

Offer e answer vão **sempre como anexo `.txt`**, nunca inline. Isso remove
qualquer preocupação com o limite de 2000 chars, elimina a necessidade de
compressão e mantém o SDP legível para debug.

**Nome do arquivo carrega o roteamento:**

```
p2p.<sessionId>.<kind>.<targetUserId>.txt
       kind ∈ { offer, answer }
```

O remetente é o autor da mensagem; o destinatário está no nome. Um cliente só
baixa o anexo se `targetUserId` for o seu e o `sessionId` for de uma sessão que
ele conhece — ninguém desperdiça request com handshake alheio.

**Conteúdo:** JSON puro, sem compressão.

```jsonc
{
  "v": 1,
  "type": "offer" | "answer",
  "sdp": "<SDP completo, com todos os candidatos ICE>"
}
```

O corpo da mensagem fica vazio, com um marcador zero-width para o plugin
reconhecer e esconder da própria view.

**Auto-delete:** cada lado deleta a própria mensagem de handshake assim que a
`RTCPeerConnection` chega a `connected`, ou após 20s, o que vier primeiro. O
beacon não é deletado até a transmissão acabar.

### ICE não-trickle

Ambos os lados esperam `iceGatheringState === "complete"` antes de postar o SDP,
com teto de 4s. Isso troca ~1-3s de latência no setup por um protocolo com uma
mensagem por lado em vez de um fluxo contínuo de candidatos — decisivo quando o
canal de sinalização são mensagens de chat.

### Máquina de estados

**Broadcaster:**

```
idle ──start()──► capturing ──postBeacon──► live
live: para cada offer recebida → cria PC → posta answer → peer connected
live ──stop()──► deleta beacon, fecha todos os PCs ──► idle
```

**Viewer:**

```
idle ──beacon detectado──► available
available ──clique "Assistir"──► offering (cria PC, posta offer)
offering ──answer recebida──► connecting ──ontrack──► watching
watching ──beacon deletado | PC failed──► idle
```

## Módulos

Cada módulo é testável isoladamente; só `discord/` toca a API do Discord.

| Arquivo | Responsabilidade | Depende de |
|---|---|---|
| `codec.ts` | encode/decode zero-width; parse/format do nome de arquivo de handshake | nada (puro) |
| `bitrate.ts` | orçamento de upload → maxBitrate por peer | nada (puro) |
| `signaling.ts` | postar/observar/deletar beacon e handshakes | `discord/`, `codec.ts` |
| `peers.ts` | ciclo de vida das `RTCPeerConnection`, offer/answer, aplicação de bitrate | `bitrate.ts` |
| `capture.ts` | obter o `MediaStream` da tela (cadeia de fallback) | `discord/` |
| `broadcast.ts` | orquestra captura + beacon + peers (lado emissor) | `capture`, `signaling`, `peers` |
| `watch.ts` | orquestra descoberta + offer + render (lado receptor) | `signaling`, `peers` |
| `discord/` | wrappers finos sobre `MessageActions`, `CloudUpload`, `RestAPI`, `FluxDispatcher` | webpack do Discord |
| `ui/` | botão de transmitir, overlay do viewer, botão Assistir no beacon | React |
| `index.tsx` | `definePlugin`, settings, patches | tudo |

### Captura de tela — cadeia de fallback

Não é certo qual API está disponível no Electron do Discord, então `capture.ts`
tenta em ordem e a primeira que funcionar vence:

1. `navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })`
2. `DiscordNative.desktopCapture.getDesktopCaptureSources()` + `getUserMedia` com
   `chromeMediaSource: "desktop"` e o `chromeMediaSourceId` escolhido
3. Erro explícito para o usuário

Isso resolve o risco de captura sem precisar de um spike bloqueante.

### Envio de anexo

Segue o padrão do plugin `voiceMessages` do próprio Vencord: instanciar
`CloudUpload` com um `File`, escutar `complete`, e então `RestAPI.post` no
endpoint de mensagens com o `uploaded_filename` retornado.

## Banda adaptativa

Setting `uploadBudgetMbps` (padrão **15**). A cada entrada/saída de viewer:

```
perPeer = clamp(budget / viewerCount, 800 kbps, 8 Mbps)
```

Aplicado em todos os senders via `sender.setParameters({ encodings: [{ maxBitrate }] })`,
com `degradationPreference: "maintain-framerate"`.

Efeito com o padrão de 15 Mbps: 2 viewers → 7,5 Mbps cada (1080p60 confortável);
6 viewers → 2,5 Mbps cada (720p30). Sem intervenção do usuário.

## UI

**Iniciar transmissão**
- Primário: botão ao lado do controle de tela nativo, no painel de voz.
- Fallback: comando `/p2pshare`. O patch do painel de voz é o ponto mais frágil
  do plugin (regex contra o bundle do Discord); o comando garante que o plugin
  continua utilizável quando o patch quebra numa atualização.

**Assistir**
- Botão renderizado no lugar do beacon, via accessory de mensagem.

**Overlay do viewer**
- Componente React em portal no `document.body`. Arrastável, redimensionável,
  com fullscreen e controle de volume. Posição e tamanho persistem nas settings.

**Indicadores para o broadcaster**
- Contador de viewers conectados e bitrate atual por peer.

## Tratamento de erros

| Situação | Comportamento |
|---|---|
| ICE não conecta em 30s | Fecha o PC, toast: "não conectou — provável CGNAT/NAT simétrico. Sem TURN não tem como" |
| Nenhuma API de captura disponível | Toast explicando, transmissão não inicia |
| Beacon deletado / broadcaster saiu do canal | Viewers fecham o overlay sozinhos |
| Upload do anexo falha | Retry 1x, depois aborta aquele peer |
| `sessionId` desconhecido no handshake | Ignora silenciosamente |
| Anexo com JSON inválido | Ignora, loga no console |

## Testes

**Unitários** (cobrem toda a lógica pura):
- `codec.ts` — roundtrip zero-width, incluindo texto com emoji e caracteres
  multi-byte; parse de nome de arquivo válido e inválido.
- `bitrate.ts` — clamp nos dois extremos, divisão por zero viewers.
- `peers.ts` — máquina de estados com `RTCPeerConnection` mockada.

**Manual** (WebRTC real e patches do Discord não dão para automatizar):
- Dois clientes, mesma sala: conectar, ver vídeo, parar.
- Três+ viewers: confirmar que o bitrate por peer cai.
- Viewer entrando no meio da transmissão.
- Broadcaster fechando o Discord abruptamente.

## Riscos

1. **Patch do painel de voz quebra em updates do Discord.** Mitigado pelo comando
   slash como caminho alternativo.
2. **NAT simétrico.** Sem TURN, alguns pares nunca conectam. Aceito e comunicado
   ao usuário; adicionar TURN é uma extensão futura de uma linha de config.
3. **API de captura.** Mitigado pela cadeia de fallback.
4. **ToS do Discord.** Client mods violam os termos. Risco assumido pelo usuário.
5. **Spam de mensagens.** Cada viewer gera 2 mensagens por sessão, deletadas em
   seguida. Com 6 viewers são 12 mensagens efêmeras — dentro do rate limit.
