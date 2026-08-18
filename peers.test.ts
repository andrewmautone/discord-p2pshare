/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BroadcastPeers, ViewerPeer } from "./peers";

/** RTCPeerConnection falsa, suficiente para exercitar a máquina de estados. */
class FakePeer {
    iceGatheringState = "complete";
    connectionState = "new";
    localDescription: any = null;
    remoteDescription: any = null;
    senders: any[] = [];
    transceivers: any[] = [];
    closed = false;
    onconnectionstatechange: (() => void) | null = null;
    ontrack: ((e: any) => void) | null = null;
    onicegatheringstatechange: (() => void) | null = null;

    addTrack(track: any) {
        const sender = {
            track,
            params: { encodings: [{}] } as any,
            getParameters() { return this.params; },
            async setParameters(p: any) { this.params = p; }
        };
        this.senders.push(sender);
        return sender;
    }

    addTransceiver(kind: string, init: any) {
        const t = { kind, init };
        this.transceivers.push(t);
        return t;
    }

    getSenders() { return this.senders; }
    async createOffer() { return { type: "offer", sdp: "SDP_OFFER" }; }
    async createAnswer() { return { type: "answer", sdp: "SDP_ANSWER" }; }
    async setLocalDescription(d: any) { this.localDescription = d; }
    async setRemoteDescription(d: any) { this.remoteDescription = d; }
    close() { this.closed = true; this.connectionState = "closed"; }
}

function recordingTransport() {
    const sent: { kind: string; target: string; sdp: string; }[] = [];
    return {
        sent,
        transport: {
            async send(kind: any, target: string, sdp: string) {
                sent.push({ kind, target, sdp });
            }
        }
    };
}

const fakeStream = {
    getTracks: () => [{ kind: "video", id: "t1" }]
} as unknown as MediaStream;

describe("BroadcastPeers", () => {
    it("responde uma offer com uma answer para quem mandou", async () => {
        const { sent, transport } = recordingTransport();
        const peers = new BroadcastPeers(fakeStream, transport, {
            budgetMbps: 15,
            createPeer: () => new FakePeer() as any
        });

        await peers.handleOffer("viewer1", "SDP_OFFER");

        assert.equal(sent.length, 1);
        assert.equal(sent[0].kind, "answer");
        assert.equal(sent[0].target, "viewer1");
        assert.equal(sent[0].sdp, "SDP_ANSWER");
    });

    it("conta os viewers conectados", async () => {
        const { transport } = recordingTransport();
        const peers = new BroadcastPeers(fakeStream, transport, {
            budgetMbps: 15,
            createPeer: () => new FakePeer() as any
        });

        await peers.handleOffer("viewer1", "SDP");
        await peers.handleOffer("viewer2", "SDP");
        assert.equal(peers.viewerCount, 2);

        peers.removePeer("viewer1");
        assert.equal(peers.viewerCount, 1);
    });

    it("substitui a conexão quando o mesmo viewer manda outra offer", async () => {
        const { transport } = recordingTransport();
        const created: FakePeer[] = [];
        const peers = new BroadcastPeers(fakeStream, transport, {
            budgetMbps: 15,
            createPeer: () => { const p = new FakePeer(); created.push(p); return p as any; }
        });

        await peers.handleOffer("viewer1", "SDP");
        await peers.handleOffer("viewer1", "SDP");

        assert.equal(peers.viewerCount, 1);
        assert.equal(created[0].closed, true, "a conexão antiga deve ser fechada");
    });

    it("aplica o bitrate dividido pelo número de viewers", async () => {
        const { transport } = recordingTransport();
        const created: FakePeer[] = [];
        const peers = new BroadcastPeers(fakeStream, transport, {
            budgetMbps: 15,
            createPeer: () => { const p = new FakePeer(); created.push(p); return p as any; }
        });

        await peers.handleOffer("viewer1", "SDP");
        // 1 viewer: 15 Mbps cai no teto de 8 Mbps
        assert.equal(created[0].senders[0].params.encodings[0].maxBitrate, 8_000_000);

        await peers.handleOffer("viewer2", "SDP");
        await peers.handleOffer("viewer3", "SDP");
        // 3 viewers: 5 Mbps cada, reaplicado em todo mundo
        assert.equal(created[0].senders[0].params.encodings[0].maxBitrate, 5_000_000);
        assert.equal(created[2].senders[0].params.encodings[0].maxBitrate, 5_000_000);
    });

    it("avisa quando a contagem muda", async () => {
        const { transport } = recordingTransport();
        const counts: number[] = [];
        const peers = new BroadcastPeers(fakeStream, transport, {
            budgetMbps: 15,
            createPeer: () => new FakePeer() as any
        });
        peers.onCountChange = n => counts.push(n);

        await peers.handleOffer("viewer1", "SDP");
        peers.removePeer("viewer1");

        assert.deepEqual(counts, [1, 0]);
    });

    it("remove o peer quando a conexão falha", async () => {
        const { transport } = recordingTransport();
        let created: FakePeer;
        const peers = new BroadcastPeers(fakeStream, transport, {
            budgetMbps: 15,
            createPeer: () => { created = new FakePeer(); return created as any; }
        });

        await peers.handleOffer("viewer1", "SDP");
        created!.connectionState = "failed";
        created!.onconnectionstatechange!();

        assert.equal(peers.viewerCount, 0);
    });

    it("fecha todas as conexões em closeAll", async () => {
        const { transport } = recordingTransport();
        const created: FakePeer[] = [];
        const peers = new BroadcastPeers(fakeStream, transport, {
            budgetMbps: 15,
            createPeer: () => { const p = new FakePeer(); created.push(p); return p as any; }
        });

        await peers.handleOffer("viewer1", "SDP");
        await peers.handleOffer("viewer2", "SDP");
        peers.closeAll();

        assert.equal(peers.viewerCount, 0);
        assert.ok(created.every(p => p.closed));
    });
});

describe("ViewerPeer", () => {
    it("manda uma offer para o broadcaster em start", async () => {
        const { sent, transport } = recordingTransport();
        const viewer = new ViewerPeer(transport, "broadcaster1", {
            createPeer: () => new FakePeer() as any
        });

        await viewer.start();
        viewer.close();

        assert.equal(sent.length, 1);
        assert.equal(sent[0].kind, "offer");
        assert.equal(sent[0].target, "broadcaster1");
        assert.equal(sent[0].sdp, "SDP_OFFER");
    });

    it("pede só recepção, sem mandar mídia", async () => {
        const { transport } = recordingTransport();
        let created: FakePeer;
        const viewer = new ViewerPeer(transport, "broadcaster1", {
            createPeer: () => { created = new FakePeer(); return created as any; }
        });

        await viewer.start();
        viewer.close();

        assert.deepEqual(
            created!.transceivers.map(t => [t.kind, t.init.direction]),
            [["video", "recvonly"], ["audio", "recvonly"]]
        );
    });

    it("aplica a answer recebida", async () => {
        const { transport } = recordingTransport();
        let created: FakePeer;
        const viewer = new ViewerPeer(transport, "broadcaster1", {
            createPeer: () => { created = new FakePeer(); return created as any; }
        });

        await viewer.start();
        await viewer.handleAnswer("SDP_ANSWER");
        viewer.close();

        assert.equal(created!.remoteDescription.sdp, "SDP_ANSWER");
    });

    it("entrega o stream recebido via ontrack", async () => {
        const { transport } = recordingTransport();
        let created: FakePeer;
        const viewer = new ViewerPeer(transport, "broadcaster1", {
            createPeer: () => { created = new FakePeer(); return created as any; }
        });

        const received: MediaStream[] = [];
        viewer.onStream = s => received.push(s);

        await viewer.start();
        created!.ontrack!({ streams: [fakeStream] });
        viewer.close();

        assert.deepEqual(received, [fakeStream]);
    });

    it("avisa quando a conexão falha, citando NAT simétrico", async () => {
        const { transport } = recordingTransport();
        let created: FakePeer;
        const viewer = new ViewerPeer(transport, "broadcaster1", {
            createPeer: () => { created = new FakePeer(); return created as any; }
        });

        const failures: string[] = [];
        viewer.onFailed = r => failures.push(r);

        await viewer.start();
        created!.connectionState = "failed";
        created!.onconnectionstatechange!();
        viewer.close();

        assert.equal(failures.length, 1);
        assert.match(failures[0], /NAT sim/i);
    });
});
