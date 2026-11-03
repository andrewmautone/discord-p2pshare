/*
 * Sonda os relays Nostr: para cada um, uma conexão se inscreve no tópico e
 * outra publica um evento efêmero do P2PShare. Mede se chega e em quanto
 * tempo. Uso: npx tsx scripts/relay-probe.ts [wss://...]
 */

import { RELAYS } from "../constants";
import { finalizeEvent, P2PSHARE_KIND, verifyEvent } from "../nostr/event";
import { roomTopic, sealRoom } from "../nostr/room";
import { generateSecretKey } from "../nostr/schnorr";

const urls = process.argv.slice(2).length ? process.argv.slice(2) : RELAYS;

async function probe(url: string): Promise<string> {
    const topic = await roomTopic("probe-" + Math.random());
    const sk = generateSecretKey();
    const ev = await finalizeEvent({ kind: P2PSHARE_KIND, tags: [["t", topic]], content: await sealRoom("x", { ping: 1 }) }, sk);

    return new Promise(resolve => {
        const done = (msg: string) => {
            clearTimeout(timer);
            try { sub.close(); } catch { }
            try { pub.close(); } catch { }
            resolve(msg);
        };
        const timer = setTimeout(() => done("TIMEOUT (10s)"), 10_000);
        let t0 = 0;
        let ok = "";

        const sub = new WebSocket(url);
        const pub = new WebSocket(url);
        sub.onerror = () => done("erro de conexão (sub)");
        pub.onerror = () => done("erro de conexão (pub)");
        sub.onopen = () => {
            sub.send(JSON.stringify(["REQ", "s1", { kinds: [P2PSHARE_KIND], "#t": [topic] }]));
            const go = () => { t0 = Date.now(); pub.send(JSON.stringify(["EVENT", ev])); };
            if (pub.readyState === 1) setTimeout(go, 300); else pub.onopen = () => setTimeout(go, 300);
        };
        pub.onmessage = m => {
            const msg = JSON.parse(String(m.data));
            if (msg[0] === "OK") ok = msg[2] ? "aceito" : `RECUSADO: ${msg[3]}`;
            if (msg[0] === "OK" && !msg[2]) done(ok);
        };
        sub.onmessage = async m => {
            const msg = JSON.parse(String(m.data));
            if (msg[0] === "EVENT" && msg[2]?.id === ev.id) {
                const valid = await verifyEvent(msg[2]);
                done(`OK ${Date.now() - t0} ms (${ok || "sem OK"}, assinatura ${valid ? "válida" : "INVÁLIDA"})`);
            }
        };
    });
}

void (async () => {
    const results = await Promise.all(urls.map(async u => [u, await probe(u)] as const));
    for (const [u, r] of results) console.log(u.padEnd(32), r);
})();
