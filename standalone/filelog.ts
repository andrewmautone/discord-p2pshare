/*
 * Log do carregador em %AppData%\P2PShare\loader.log.
 *
 * O console da pagina do Discord nao vai para lugar nenhum que o usuario veja;
 * sem este arquivo, "o P2PShare nao apareceu" nao tem diagnostico. Tamanho
 * limitado: passando de 256 KB, recomeca.
 */

import * as path from "path";

const fs = require("original-fs") as typeof import("fs");

const FILE = path.join(process.env.APPDATA || "", "P2PShare", "loader.log");
const MAX = 256 * 1024;

export function fileLog(where: string, ...args: unknown[]): void {
    const text = args.map(a => {
        if (a instanceof Error) return `${a.message}\n${a.stack ?? ""}`;
        if (typeof a === "string") return a;
        try {
            return JSON.stringify(a);
        } catch {
            return String(a);
        }
    }).join(" ");

    console.log(`[P2PShare] ${where}:`, ...args);

    try {
        if (fs.existsSync(FILE) && fs.statSync(FILE).size > MAX) fs.writeFileSync(FILE, "");
        fs.appendFileSync(FILE, `${new Date().toISOString()} [${where}] ${text}\n`);
    } catch {
        // log nunca derruba nada
    }
}
