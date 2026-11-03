/*
 * Busca de modulos no webpack do Discord, com a mesma semantica que o
 * P2PShare usa do BdApi.Webpack.getModule:
 *
 *  - sem opcoes: testa o exports do modulo e o seu `default`;
 *  - searchExports: testa cada export do modulo (funcoes e objetos soltos);
 *  - first=false devolve todos os que passam.
 *
 * Nao depende do Discord: recebe o cache de modulos e e testado em Node.
 */

export type Filter = (m: any) => unknown;

export type GetModuleOptions = {
    first?: boolean;
    defaultExport?: boolean;
    searchExports?: boolean;
};

type Cache = Record<string, { exports?: unknown; } | undefined>;

function safeTest(filter: Filter, value: unknown): boolean {
    try {
        return Boolean(filter(value));
    } catch {
        return false;
    }
}

function isSearchable(value: unknown): value is Record<string, unknown> {
    return value !== null && (typeof value === "object" || typeof value === "function");
}

/**
 * Valores que nunca sao o modulo procurado e casariam com qualquer filtro.
 *
 * O caso que importa e o proxy de traducoes do Discord: toda propriedade dele
 * devolve uma funcao, entao `m?.getCurrentUser && m?.getUser` casava com ele
 * antes do UserStore, e o plugin rodava com stores falsos. BD e Vencord pulam
 * esse proxy pelo mesmo Symbol.toStringTag.
 */
function skip(value: unknown): boolean {
    const g = globalThis as any;
    if (value === g.window || value === g.document || value === g.document?.documentElement) return true;
    try {
        return (value as any)?.[Symbol.toStringTag] === "IntlMessagesProxy";
    } catch {
        return true;
    }
}

function matchModule(exp: unknown, filter: Filter, opts: GetModuleOptions): unknown {
    if (!isSearchable(exp) || skip(exp)) return undefined;

    if (opts.searchExports) {
        if (safeTest(filter, exp)) return exp;

        let keys: string[];
        try {
            keys = Object.keys(exp);
        } catch {
            return undefined;
        }
        for (const key of keys) {
            let value: unknown;
            try {
                value = exp[key];
            } catch {
                continue;
            }
            if (isSearchable(value) && !skip(value) && safeTest(filter, value)) return value;
        }
        return undefined;
    }

    if (safeTest(filter, exp)) return exp;

    let def: unknown;
    try {
        def = exp.default;
    } catch {
        def = undefined;
    }
    if (isSearchable(def) && !skip(def) && safeTest(filter, def)) {
        return opts.defaultExport === false ? exp : def;
    }
    return undefined;
}

export function searchModules(cache: Cache | null | undefined, filter: Filter, opts: GetModuleOptions = {}): any {
    const first = opts.first !== false;
    const found: unknown[] = [];

    if (!cache || typeof filter !== "function") return first ? undefined : found;

    for (const id of Object.keys(cache)) {
        const hit = matchModule(cache[id]?.exports, filter, opts);
        if (hit === undefined) continue;
        if (first) return hit;
        found.push(hit);
    }

    return first ? undefined : found;
}
