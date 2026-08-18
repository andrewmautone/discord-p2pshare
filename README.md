# P2PShare

Compartilhamento de tela ponto-a-ponto para Discord, via Vencord.

O vídeo vai direto de PC para PC por WebRTC — sem passar pela infra de vídeo do
Discord e sem cap de bitrate. A sinalização usa mensagens do próprio canal de
voz, então não existe servidor.

## Instalação

```bash
git clone https://github.com/Vendicated/Vencord
cd Vencord
pnpm i
git clone <url deste repo> src/userplugins/p2pShare
pnpm build
pnpm inject
```

Ative **P2PShare** nas configurações do Vencord.

## Uso

- **Transmitir:** entre num canal de voz e rode `/p2pshare`.
- **Assistir:** quando alguém transmite, aparece um botão **Assistir** na
  mensagem de aviso no chat do canal.

Quem não tem o plugin vê só a mensagem de aviso com o link de instalação — nada
de texto codificado.

## Como funciona

| Peça | Papel |
|---|---|
| Beacon | Mensagem legível no chat, com o `sessionId` escondido em caracteres zero-width. Fica no ar enquanto a transmissão dura. |
| Handshake | Offer/answer em anexo `.txt`, roteado pelo nome do arquivo (`p2p.<sessão>.<tipo>.<destinatário>.txt`) e auto-deletado em 20s. |
| Mídia | WebRTC direto entre os pares. Não toca no servidor do Discord. |

ICE é não-trickle: cada lado espera o gathering completar antes de postar um SDP
único, porque um canal de sinalização feito de mensagens de chat não comporta um
fluxo contínuo de candidatos.

## Limitações

- **Sem TURN.** Quem estiver atrás de NAT simétrico (CGNAT, algumas redes
  corporativas) não conecta. O plugin avisa em vez de ficar travado.
- **Mesh.** O upload do broadcaster é dividido entre os viewers. Acima de ~6
  pessoas a qualidade por viewer fica ruim.
- Client mods violam os Termos de Serviço do Discord.

## Desenvolvimento

```bash
# a partir da raiz do Vencord
pnpm exec tsx --test src/userplugins/p2pShare/*.test.ts
pnpm exec tsc --noEmit
pnpm build
```

Os módulos puros (`codec.ts`, `bitrate.ts`, `capture.ts`, `peers.ts`) não
importam nada do Vencord — é isso que os torna testáveis com o runner nativo do
Node, sem dependência nova nenhuma.
