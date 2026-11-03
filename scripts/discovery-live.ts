/*
 * Teste de integração contra os relays públicos de verdade, sem Discord:
 * dois clientes completos (RelayPool + Discovery) na mesma sala. Mede o
 * tempo até o aviso aparecer, o handshake com SDP de tamanho real e o fim.
 * Uso: npx tsx scripts/discovery-live.ts
 */

import { RELAYS } from "../constants";
import { Discovery } from "../discovery";
import { P2PSHARE_KIND } from "../nostr/event";
import { RelayPool, type RelaySocket } from "../nostr/pool";

function nodeSocket(url: string): RelaySocket {
    const ws = new WebSocket(url);
    const s: RelaySocket = {
        onopen: null, onmessage: null, onclose: null,
        send: d => { if (ws.readyState === WebSocket.OPEN) ws.send(d); },
        close: () => ws.close()
    };
    ws.onopen = () => s.onopen?.();
    ws.onmessage = e => s.onmessage?.(String(e.data));
    ws.onclose = () => s.onclose?.();
    ws.onerror = () => { };
    return s;
}

const CH = "teste-" + Math.random().toString(36).slice(2);
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

async function until(cond: () => boolean, ms: number): Promise<number> {
    const t0 = Date.now();
    while (!cond()) {
        if (Date.now() - t0 > ms) throw new Error("tempo esgotado");
        await wait(20);
    }
    return Date.now() - t0;
}

void (async () => {
    const poolA = new RelayPool(RELAYS, nodeSocket, { kind: P2PSHARE_KIND });
    const poolB = new RelayPool(RELAYS, nodeSocket, { kind: P2PSHARE_KIND });
    const a = new Discovery(poolA, { me: () => ({ id: "111", name: "Transmissor" }) });
    const b = new Discovery(poolB, { me: () => ({ id: "222", name: "Espectador" }) });

    try {
        await b.watch([CH]);
        await until(() => poolA.openCount > 0 && poolB.openCount > 0, 10_000);
        console.log(`relays abertos: A=${poolA.openCount} B=${poolB.openCount} de ${RELAYS.length}`);
        await wait(500);

        a.startLive(CH, "sessao1");
        const tLive = await until(() => b.live().length === 1, 10_000);
        console.log(`aviso chegou em ${tLive} ms:`, b.live()[0].name);

        const sdp = "v=0\r\n" + "a=candidate:x ".repeat(430); // ~6 KB, como um SDP não-trickle
        let gotOffer = "", gotAnswer = "";
        a.onSignal(s => { gotOffer = s.sdp; });
        b.onSignal(s => { gotAnswer = s.sdp; });

        let t0 = Date.now();
        await b.sendSignal(CH, "sessao1", "offer", "111", sdp);
        await until(() => gotOffer === sdp, 10_000);
        console.log(`offer (${sdp.length} bytes) chegou em ${Date.now() - t0} ms`);

        t0 = Date.now();
        await a.sendSignal(CH, "sessao1", "answer", "222", "ANSWER");
        await until(() => gotAnswer === "ANSWER", 10_000);
        console.log(`answer chegou em ${Date.now() - t0} ms`);

        // Renovação: o aviso continua vivo depois de passar o TTL de 15 s.
        await wait(17_000);
        console.log(`depois de 17 s o aviso ${b.live().length === 1 ? "continua (renovado)" : "SUMIU"}`);

        t0 = Date.now();
        a.close(); // manda o fim
        await until(() => b.live().length === 0, 10_000);
        console.log(`fim chegou em ${Date.now() - t0} ms`);
        console.log("RESULTADO: OK");
    } catch (err) {
        console.log("RESULTADO: FALHOU", err);
        process.exitCode = 1;
    } finally {
        b.close();
        poolA.close();
        poolB.close();
        setTimeout(() => process.exit(), 500);
    }
})();
