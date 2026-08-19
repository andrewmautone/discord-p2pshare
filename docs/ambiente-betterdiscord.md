# O que existe dentro do BetterDiscord

Levantado por sondagem no cliente real (Electron 42.7.1, Chrome 148), com o
plugin gravando o resultado em disco. Está aqui porque descobrir isso tentando
custa uma queda do Discord por palpite.

## Módulos do Node

O `require` que o plugin recebe atende uma lista curta e tenta resolver o resto
como caminho de arquivo — daí o `ENOENT` apontando para dentro da pasta do
Discord, que parece bug e é só a lista dizendo não.

| Módulo | Estado |
| --- | --- |
| `fs`, `path`, `crypto`, `electron`, `process`, `vm` | disponíveis |
| `child_process`, `net`, `http`, `stream`, `os`, `worker_threads` | ENOENT |

`window.require` **é o mesmo objeto** que o `require` do plugin — não é uma
saída. O carregador interno (`Module._load`) não está alcançável pelo
construtor dos módulos carregados.

## O `fs` não é o do Node

É um shim com superfície reduzida, e o que ele devolve não é o que o Node
devolveria:

| Função | Estado |
| --- | --- |
| `readFileSync`, `writeFileSync`, `existsSync`, `statSync`, `watch` | existem |
| `openSync`, `readSync`, `closeSync`, `fstatSync`, `createReadStream`, `appendFileSync` | ausentes |

**`readFileSync` devolve string decodificada como UTF-8, não Buffer.** Em
binário isso é destrutivo: o auxiliar de áudio, com 173568 bytes em disco,
virava 171890 caracteres, e o SHA-256 nunca batia. Ler como `latin1` mapeia
byte a byte sem perda — é o que `binary.ts` faz, conferindo o resultado contra
`statSync().size`.

Sem leitura posicional e sem streams, ler um arquivo que cresce significa
reler tudo a cada vez. Isso descarta arquivo como canal de áudio contínuo.

## Iniciar um processo

`process.binding("process_wrap")` responde e entrega `Process`, mas usá-lo
**derruba o Discord**: são ligações internas, e no Node 24 elas abortam o
processo em vez de lançar exceção — nenhum `catch` alcança. Foi reproduzido.

O que sobra, todos presentes:

- `electron.shell.openPath` e `openExternal` — iniciam um programa, mas **não
  passam argumentos**. O auxiliar precisa ler a configuração de um arquivo ao
  lado dele.
- `electron.ipcRenderer.invoke` — só alcança canais que o Discord registrou.
- `DiscordNative.nativeModules.requireModule` — só os módulos nativos do
  próprio Discord.

O `electron` exposto ao plugin traz apenas `{ ipcRenderer, shell, webUtils }`.

## Trazer dados de volta

Sem `net` e sem `http`, sobra HTTP em `127.0.0.1` — e a política de conteúdo
do Discord **libera**. Medido contra um servidor local:

| Caminho | Resultado |
| --- | --- |
| `fetch` do renderer | HTTP 200, 256 bytes, íntegros |
| `BdApi.Net.fetch` | HTTP 200, 256 bytes, íntegros |

E o streaming é incremental de verdade, que é o que áudio contínuo exige. Dez
pedaços enviados com 100 ms de intervalo, lidos com `res.body.getReader()`:

```
pedaços 10   primeiro 109 ms   último 1080 ms   incremental: sim
```

`BdApi.Net.WebSocket` não existe.

## Desenho que essas restrições permitem

O auxiliar deixa de escrever PCM no stdout e passa a servi-lo por HTTP em
`127.0.0.1`, numa porta efêmera. O plugin o inicia por `shell.openPath`, com os
argumentos num arquivo de configuração ao lado do executável, e consome o áudio
com `fetch` + `getReader()`. Nenhuma ligação interna do Node no caminho.
