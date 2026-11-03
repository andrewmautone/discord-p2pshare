"use strict";

/*
 * P2PShare — gancho no Discord.
 *
 * Este arquivo mora dentro de um app.asar pequeno criado pelo instalador do
 * P2PShare. O app.asar original do Discord foi renomeado, sem alteracao, para
 * app.orig.asar ao lado. Aqui o P2PShare e ligado e o controle vai para o
 * original.
 *
 * Desinstalar ("Aplicativos instalados" > P2PShare) apaga este arquivo e
 * devolve o nome ao original. Se a pasta %AppData%\P2PShare sumir, o Discord
 * abre normalmente, sem nada.
 */

const path = require("path");
const fs = require("original-fs");

const resources = path.join(__dirname, "..");
const discordAsar = path.join(resources, "app.orig.asar");

try {
    const core = path.join(process.env.APPDATA || "", "P2PShare", "core", "main.js");
    if (fs.existsSync(core)) require(core).init({ resources });
} catch (err) {
    // Qualquer falha nossa nao pode impedir o Discord de abrir.
    console.error("[P2PShare] o carregador falhou; o Discord abre sem o P2PShare.", err);
}

const { app } = require("electron");
const pkg = require(path.join(discordAsar, "package.json"));

app.setAppPath(discordAsar);
app.name = pkg.name;
require.main.filename = path.join(discordAsar, pkg.main);

require(path.join(discordAsar, pkg.main));
