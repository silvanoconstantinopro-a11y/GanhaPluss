/**
 * ===========================================================
 *      GANHAPLUS - FRONTEND PROFISSIONAL v7.0 (SEGURANÇA OTIMIZADA)
 * ===========================================================
 */

const BASE_URL = "http://localhost:4000";
const TOKEN_KEY = "gp_token";

const RECOMPENSA_ANUNCIO = 500;
const MAX_ADS = 4;

/* ===========================================================
   TOKEN E AUTENTICAÇÃO
=========================================================== */
const salvarToken = t => localStorage.setItem(TOKEN_KEY, t);
const obterToken = () => localStorage.getItem(TOKEN_KEY);
const sair = () => { localStorage.removeItem(TOKEN_KEY); window.location.href = "login.html"; };

const parseJwt = t => {
    try { return JSON.parse(atob(t.split(".")[1])); }
    catch { return null; }
};

async function obterUsuario() {
    const token = obterToken();
    if (!token) return sair();
    const payload = parseJwt(token);
    if (!payload?.id) return sair();
    return payload;
}

/* ===========================================================
   FETCH SEGURO
=========================================================== */
async function requestSeguro(url, options = {}) {
    try {
        const r = await fetch(url, options);
        const txt = await r.text();
        let dados;
        try { dados = txt ? JSON.parse(txt) : {}; }
        catch { dados = { raw: txt }; }
        return { ok: r.ok, status: r.status, dados };
    } catch {
        return { ok: false, status: 0, dados: { erro: "Erro de conexão" } };
    }
}

/* ===========================================================
   LOGIN
=========================================================== */
async function login() {
    const telefone = document.getElementById("login-telefone").value.trim();
    const senha = document.getElementById("login-senha").value;
    const msg = document.getElementById("mensagem");

    if (!telefone || !senha) return msg.textContent = "Preencha todos os campos!";

    const { ok, dados } = await requestSeguro(`${BASE_URL}/api/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ telefone, senha })
    });

    if (!ok) return msg.textContent = dados?.erro || "Erro no login";

    salvarToken(dados.token);
    window.location.href = "principal.html";
}

/* ===========================================================
   REGISTO
=========================================================== */
async function registrar() {
    const telefone = document.getElementById("reg-telefone").value.trim();
    const senha = document.getElementById("reg-senha").value;
    const idade = Number(document.getElementById("reg-idade").value);
    const msg = document.getElementById("mensagem");

    if (!telefone || !senha || !idade) return msg.textContent = "Preencha todos os campos!";
    if (idade < 18) return msg.textContent = "Apenas maiores de 18 anos!";

    const { ok, dados } = await requestSeguro(`${BASE_URL}/api/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ telefone, senha, idade })
    });

    if (!ok) return msg.textContent = dados?.erro || "Erro no registo";

    salvarToken(dados.token);
    window.location.href = "principal.html";
}

/* ===========================================================
   PAINEL
=========================================================== */
async function carregarPainel() {
    try {
        const perfil = await obterUsuario();
        const token = obterToken();
        const { ok, dados } = await requestSeguro(`${BASE_URL}/api/saldo/${perfil.id}`, {
            headers: { "Authorization": "Bearer " + token }
        });
        if (ok) document.getElementById("saldo-valor").textContent = `${dados.saldo} AOA`;

        document.getElementById("fazer-anuncio")?.addEventListener("click", abrirSequenciaAnuncios);
        document.getElementById("fazer-compartilhar")?.addEventListener("click", compartilhar);
    } catch (err) {
        console.error("Erro ao carregar painel:", err);
        alert("Erro ao carregar o painel. Faça login novamente.");
        sair();
    }
}

/* ===========================================================
   SISTEMA DE ANÚNCIOS (GOOGLE IMA)
=========================================================== */
const AD_TAGS = [
    "https://pubads.g.doubleclick.net/gampad/ads?...1",
    "https://pubads.g.doubleclick.net/gampad/ads?...2",
    "https://pubads.g.doubleclick.net/gampad/ads?...3"
];

const escolherTag = () => AD_TAGS[Math.floor(Math.random() * AD_TAGS.length)];

function carregarIMA() {
    return new Promise((resolve, reject) => {
        if (window.google?.ima) return resolve();
        const s = document.createElement("script");
        s.src = "https://imasdk.googleapis.com/js/sdkloader/ima3.js";
        s.onload = () => setTimeout(() => window.google?.ima ? resolve() : reject("IMA não carregou"), 500);
        s.onerror = () => reject("Erro ao carregar script IMA");
        document.head.appendChild(s);
    });
}

async function abrirSequenciaAnuncios() {
    try {
        for (let i = 0; i < MAX_ADS; i++) {
            await executarAnuncio();
        }
        alert(`+${RECOMPENSA_ANUNCIO} AOA creditados!`);
        carregarPainel();
    } catch (err) {
        console.error("Erro na sequência de anúncios:", err);
        alert("Erro ao carregar anúncios. Tente novamente mais tarde.");
    }
}

async function executarAnuncio() {
    const tag = escolherTag();
    await carregarIMA();
    return tocarAnuncio(tag);
}

function tocarAnuncio(tag) {
    return new Promise((resolve, reject) => {
        const fundo = document.createElement("div");
        fundo.style = "position:fixed; inset:0; background:#000a; display:flex; justify-content:center; align-items:center; z-index:9999;";
        document.body.appendChild(fundo);

        const player = document.createElement("div");
        player.style = "width:90%; max-width:900px; height:70vh; background:#000;";
        fundo.appendChild(player);

        const fakeVideo = document.createElement("video");
        const display = new google.ima.AdDisplayContainer(player, fakeVideo);
        display.initialize();

        const loader = new google.ima.AdsLoader(display);
        const req = new google.ima.AdsRequest();
        req.adTagUrl = tag;
        req.linearAdSlotWidth = 900;
        req.linearAdSlotHeight = 600;

        loader.addEventListener(google.ima.AdsManagerLoadedEvent.Type.ADS_MANAGER_LOADED, e => {
            const manager = e.getAdsManager(fakeVideo);
            manager.addEventListener(google.ima.AdEvent.Type.COMPLETE, () => {
                fundo.remove();
                creditar(RECOMPENSA_ANUNCIO, tag);
                resolve();
            });
            try { manager.init(900, 600, google.ima.ViewMode.NORMAL); manager.start(); }
            catch { fundo.remove(); reject("Erro ao iniciar anúncio"); }
        });

        loader.addEventListener(google.ima.AdErrorEvent.Type.AD_ERROR, e => {
            fundo.remove();
            reject(e);
        });

        loader.requestAds(req);

        setTimeout(() => { if (document.body.contains(fundo)) fundo.remove(); reject("timeout"); }, 30000);
    });
}

/* ===========================================================
   CREDITAR RECOMPENSA
=========================================================== */
async function creditar(valor, ad_id) {
    try {
        const token = obterToken();
        const perfil = await obterUsuario();
        const { ok } = await requestSeguro(`${BASE_URL}/api/tarefa`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": "Bearer " + token
            },
            body: JSON.stringify({
                tipo: "anuncio",
                descricao: `Assistiu anúncio ${ad_id}`,
                valor,
                anuncio_id: ad_id
            })
        });
        if (ok) carregarPainel();
    } catch (err) {
        console.error("Erro ao creditar:", err);
    }
}

/* ===========================================================
   COMPARTILHAR
=========================================================== */
async function compartilhar() {
    try {
        const perfil = await obterUsuario();
        const token = obterToken();

        const link = `${window.location.origin}/?ref=${perfil.id}`;
        const link_id = `ref-${perfil.id}-${Date.now()}`;
        const texto = `🔥 GANHA PLUS 🔥\nGanhe 500 AOA assistindo vídeos!\n${link}`;

        await navigator.clipboard.writeText(texto);
        alert("Link copiado! Compartilhe em qualquer rede social.");

        await requestSeguro(`${BASE_URL}/api/compartilhar`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": "Bearer " + token
            },
            body: JSON.stringify({ link_id, plataforma: "Genérico" })
        });

        // Abrir opções de compartilhamento
        const facebook = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(link)}`;
        const twitter = `https://twitter.com/intent/tweet?text=${encodeURIComponent(texto)}`;
        const whatsapp = `https://wa.me/?text=${encodeURIComponent(texto)}`;

        const abrirRedes = confirm("Deseja compartilhar agora em redes sociais?");
        if (abrirRedes) { window.open(facebook, "_blank"); window.open(twitter, "_blank"); window.open(whatsapp, "_blank"); }

    } catch (err) {
        console.error("Erro ao compartilhar:", err);
        alert("Não foi possível gerar ou compartilhar o link.");
    }
}

/* ===========================================================
   HISTÓRICO
=========================================================== */
async function carregarHistorico() {
    try {
        const perfil = await obterUsuario();
        const token = obterToken();
        const { ok, dados } = await requestSeguro(`${BASE_URL}/api/historico/${perfil.id}`, {
            headers: { "Authorization": "Bearer " + token }
        });
        if (!ok) return;

        const lista = document.getElementById("historico-lista");
        lista.innerHTML = dados.historico.map(h => `
            <div class="card">
                <strong>${h.tipo}</strong> — ${h.descricao}
                <span style="float:right">${h.valor} AOA</span>
                <br><small>${h.criado_em}</small>
            </div>
        `).join("");
    } catch (err) {
        console.error("Erro ao carregar histórico:", err);
    }
}

/* ===========================================================
   SAQUE
=========================================================== */
async function carregarSaque() {
    document.getElementById("btn-withdraw")?.addEventListener("click", async () => {
        try {
            const valor = Number(document.getElementById("withdraw-valor").value);
            const numero = document.getElementById("withdraw-express").value;
            const msg = document.getElementById("withdraw-msg");

            const perfil = await obterUsuario();
            const token = obterToken();

            const { ok, dados } = await requestSeguro(`${BASE_URL}/api/withdraw`, {
                method: "POST",
                headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token },
                body: JSON.stringify({ valor, numero_express: numero })
            });

            msg.style.color = ok ? "green" : "red";
            msg.textContent = ok ? dados.mensagem : dados.erro;
            if (ok) carregarPainel();
        } catch (err) {
            console.error("Erro no saque:", err);
            alert("Erro ao solicitar saque. Tente novamente.");
        }
    });
}

/* ===========================================================
   INICIALIZAÇÃO
=========================================================== */
document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("btn-login")?.addEventListener("click", login);
    document.getElementById("btn-registar")?.addEventListener("click", registrar);
    document.getElementById("btn-logout")?.addEventListener("click", sair);

    const path = window.location.pathname;
    if (path.endsWith("principal.html")) carregarPainel();
    if (path.endsWith("Historico.html")) carregarHistorico();
    if (path.endsWith("saque.html")) carregarSaque();
});
window.abrirSequenciaAnuncios = abrirSequenciaAnuncios;
window.obterUsuario = obterUsuario;
window.carregarPainel = carregarPainel;
window.requestSeguro = requestSeguro;

