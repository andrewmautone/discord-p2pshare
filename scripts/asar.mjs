/*
 * Escritor minimo de .asar (o formato de pacote do Electron), so para o
 * gancho do P2PShare: alguns arquivos de texto na raiz, sem pastas.
 *
 * Formato: Pickle(UInt32 tamanho do cabecalho) + Pickle(String JSON do
 * indice) + conteudo dos arquivos concatenado. Offsets no JSON sao strings.
 */

function align4(n) {
    return (n + 3) & ~3;
}

/** @param {Record<string, string | Uint8Array>} files */
export function packAsar(files) {
    const enc = new TextEncoder();
    const index = { files: {} };
    const blobs = [];
    let offset = 0;

    for (const [name, content] of Object.entries(files)) {
        if (name.includes("/") || name.includes("\\")) throw new Error(`sem pastas: ${name}`);
        const bytes = typeof content === "string" ? enc.encode(content) : content;
        index.files[name] = { size: bytes.length, offset: String(offset) };
        blobs.push(bytes);
        offset += bytes.length;
    }

    const json = enc.encode(JSON.stringify(index));
    const headerPayload = 4 + align4(json.length);

    // Pickle do cabecalho: [tamanho do payload][tamanho da string][string + padding]
    const header = new Uint8Array(4 + headerPayload);
    const hv = new DataView(header.buffer);
    hv.setUint32(0, headerPayload, true);
    hv.setUint32(4, json.length, true);
    header.set(json, 8);

    // Pickle do tamanho: [4][tamanho do pickle do cabecalho]
    const size = new Uint8Array(8);
    const sv = new DataView(size.buffer);
    sv.setUint32(0, 4, true);
    sv.setUint32(4, header.length, true);

    const out = new Uint8Array(size.length + header.length + offset);
    out.set(size, 0);
    out.set(header, size.length);
    let at = size.length + header.length;
    for (const b of blobs) {
        out.set(b, at);
        at += b.length;
    }
    return out;
}

/** Leitura, para teste: devolve { nome: bytes }. */
export function unpackAsar(buf) {
    const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const headerSize = v.getUint32(4, true);
    const strLen = v.getUint32(12, true);
    const index = JSON.parse(new TextDecoder().decode(buf.subarray(16, 16 + strLen)));
    const base = 8 + headerSize;
    const out = {};
    for (const [name, e] of Object.entries(index.files)) {
        const start = base + Number(e.offset);
        out[name] = buf.subarray(start, start + e.size);
    }
    return out;
}
