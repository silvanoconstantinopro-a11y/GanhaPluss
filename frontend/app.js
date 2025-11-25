/**
 * ===========================================================
 *        GANHAPLUS - FRONTEND PROFISSIONAL v5.0
 *        Código Limpo, Organizado e Preparado p/ Anúncios
 * ===========================================================
 */

const BASE_URL = 'https://ganhapluss-1.onrender.com';
const TOKEN_KEY = 'gp_token';

const RECOMPENSA_ANUNCIO = 500; 
const MAX_ADS = 4;

/* ===========================================================
   TOKEN E SESSÃO
=========================================================== */
function salvarToken(t){ localStorage.setItem(TOKEN_KEY,t); }
function obterToken(){ return localStorage.getItem(TOKEN_KEY); }
function sair(){ localStorage.removeItem(TOKEN_KEY); window.location.href = 'login.html'; }

function parseJwt(token){
    try { return JSON.parse(atob(token.split('.')[1])); }
    catch { return null; }
}

async function obterUsuario(){
    const token = obterToken();
    if(!token) return sair();
    const payload = parseJwt(token);
    if(!payload?.id) return sair();
    return payload;
}

/* ===========================================================
   REQUEST SEGURO
=========================================================== */
async function requestSeguro(url, options = {}){
    try{
        const r = await fetch(url, options);
        const txt = await r.text();
        let dados;
        try { dados = txt ? JSON.parse(txt) : {}; }
        catch { dados = { raw: txt }; }
        return { ok: r.ok, status: r.status, dados };
    }catch{
        return { ok:false, status:0, dados:{ erro:"Erro de rede" } };
    }
}

/* ===========================================================
   LOGIN E REGISTO
=========================================================== */
async function login(){
    const telefone = document.getElementById("login-telefone").value.trim();
    const senha = document.getElementById("login-senha").value;
    const msg = document.getElementById("mensagem");

    if(!telefone || !senha){
        msg.textContent = "Preencha todos os campos!";
        return;
    }

    const { ok, dados } = await requestSeguro(`${BASE_URL}/api/login`,{
        method:"POST",
        headers:{ "Content-Type":"application/json" },
        body:JSON.stringify({ telefone, senha })
    });

    if(!ok){
        msg.textContent = dados?.erro || "Falha no login";
        return;
    }

    salvarToken(dados.token);
    window.location.href = "principal.html";
}

async function registrar(){
    const telefone = document.getElementById("reg-telefone").value.trim();
    const senha = document.getElementById("reg-senha").value;
    const idade = Number(document.getElementById("reg-idade").value);
    const msg = document.getElementById("mensagem");

    if(!telefone || !senha || !idade){
        msg.textContent = "Preencha todos os campos!";
        return;
    }
    if(idade < 18){
        msg.textContent = "Apenas maiores de 18 anos!";
        return;
    }

    const { ok, dados } = await requestSeguro(`${BASE_URL}/api/register`,{
        method:"POST",
        headers:{ "Content-Type":"application/json" },
        body:JSON.stringify({ telefone, senha, idade })
    });

    if(!ok){
        msg.textContent = dados?.erro || "Erro no registo";
        return;
    }

    salvarToken(dados.token);
    window.location.href = "principal.html";
}

/* ===========================================================
   CARREGAR PAINEL
=========================================================== */
async function carregarPainel(){
    const perfil = await obterUsuario();
    const token = obterToken();
    if(!perfil) return;

    const { ok, dados } = await requestSeguro(`${BASE_URL}/api/saldo/${perfil.id}`,{
        headers:{ "Authorization":"Bearer "+token }
    });

    if(ok){
        document.getElementById("saldo-valor").textContent = `${dados.saldo} AOA`;
    }

    document.getElementById("fazer-anuncio")?.addEventListener("click", abrirSequenciaAnuncios);
    document.getElementById("fazer-compartilhar")?.addEventListener("click", compartilhar);
}

/* ===========================================================
   REWARDED ADS
=========================================================== */
const AD_TAGS = [
    "https://pubads.g.doubleclick.net/gampad/ads?...1",
    "https://pubads.g.doubleclick.net/gampad/ads?...2",
    "https://pubads.g.doubleclick.net/gampad/ads?...3"
];

function escolherTag(){ return AD_TAGS[Math.floor(Math.random()*AD_TAGS.length)]; }

function carregarIMA(){
    return new Promise((resolve,reject)=>{
        if(window.google?.ima) return resolve();
        const s=document.createElement("script");
        s.src="https://imasdk.googleapis.com/js/sdkloader/ima3.js";
        s.onload=()=> setTimeout(()=>window.google?.ima?resolve():reject(),300);
        s.onerror=reject;
        document.head.appendChild(s);
    });
}

async function abrirSequenciaAnuncios(){
    for(let i = 0; i < MAX_ADS; i++){
        await executarAnuncio();
    }
    alert("Todos anúncios finalizados!");
}

async function executarAnuncio(){
    const tag = escolherTag();
    await carregarIMA();
    await tocarAnuncio(tag);
}

function tocarAnuncio(tag){
    return new Promise((resolve,reject)=>{

        const fundo = document.createElement("div");
        fundo.style = "position:fixed; inset:0; background:#000c; display:flex; justify-content:center; align-items:center; z-index:9999;";
        document.body.appendChild(fundo);

        const player = document.createElement("div");
        player.style = "width:90%; max-width:900px; height:70vh; background:#000;";
        fundo.appendChild(player);

        const videoFake = document.createElement("video");

        const display = new google.ima.AdDisplayContainer(player, videoFake);
        display.initialize();

        const loader = new google.ima.AdsLoader(display);
        const req = new google.ima.AdsRequest();
        req.adTagUrl = tag;
        req.linearAdSlotWidth = 900;
        req.linearAdSlotHeight = 600;

        loader.addEventListener(
            google.ima.AdsManagerLoadedEvent.Type.ADS_MANAGER_LOADED, e=>{
                const manager = e.getAdsManager(videoFake);
                manager.addEventListener(google.ima.AdEvent.Type.COMPLETE,()=>{ fundo.remove(); creditar(RECOMPENSA_ANUNCIO, tag); resolve(); });
                try{ manager.init(900,600,google.ima.ViewMode.NORMAL); manager.start(); }
                catch{ fundo.remove(); reject(); }
            }
        );

        loader.addEventListener(google.ima.AdErrorEvent.Type.AD_ERROR,e=>{
            fundo.remove();
            reject(e);
        });

        loader.requestAds(req);

        setTimeout(()=>{ fundo.remove(); reject("timeout"); },30000);
    });
}

/* ===========================================================
   CREDITAR DEPOIS DO ANÚNCIO
=========================================================== */
async function creditar(valor, ad_id){
    const token = obterToken();
    const perfil = await obterUsuario();

    const { ok, dados } = await requestSeguro(`${BASE_URL}/api/tarefa`,{
        method:"POST",
        headers:{ 
            "Content-Type":"application/json",
            "Authorization":"Bearer "+token
        },
        body:JSON.stringify({
            tipo:"anuncio",
            descricao:`Assistiu anúncio ${ad_id}`,
            valor,
            anuncio_id:ad_id
        })
    });

    if(ok){
        alert(`+${valor} AOA creditados!`);
        carregarPainel();
    }
}

/* ===========================================================
   COMPARTILHAMENTO REAL (COM IMAGEM + TEXTO + LINK)
=========================================================== */
async function compartilhar(){
    const perfil = await obterUsuario();
    const token = obterToken();

    const link = `${window.location.origin}/?ref=${perfil.id}`;
    const link_id = `ref-${perfil.id}-${Date.now()}`;

    // Copiar link
    await navigator.clipboard.writeText(link);

    alert("Link copiado! Partilhe e ganhe quando alguém clicar.");

    // Registrar no backend
    await requestSeguro(`${BASE_URL}/api/compartilhar`,{
        method:"POST",
        headers:{
            "Content-Type":"application/json",
            "Authorization":"Bearer "+token
        },
        body:JSON.stringify({
            link_id,
            plataforma:"WhatsApp"
        })
    });

    // Abrir WhatsApp com mensagem automática
    const texto = encodeURIComponent(
        `🔥 GANHA PLUS 🔥\n\nEstou a ganhar dinheiro real só assistindo anúncios!\nEntra e testa:\n${link}`
    );

    window.open(`https://wa.me/?text=${texto}`, "_blank");
}

/* ===========================================================
   HISTÓRICO
=========================================================== */
async function carregarHistorico(){
    const perfil = await obterUsuario();
    const token = obterToken();

    const { ok, dados } = await requestSeguro(`${BASE_URL}/api/historico/${perfil.id}`,{
        headers:{ "Authorization":"Bearer "+token }
    });

    if(!ok) return;

    const lista = document.getElementById("historico-lista");
    lista.innerHTML = dados.historico.map(h=>`
        <div class="card">
            <strong>${h.tipo}</strong> — ${h.descricao}
            <span style="float:right">${h.valor} AOA</span>
            <br><small>${h.criado_em}</small>
        </div>
    `).join("");
}

/* ===========================================================
   SAQUE
=========================================================== */
async function carregarSaque(){
    document.getElementById("btn-withdraw")?.addEventListener("click", async()=>{
        const valor = Number(document.getElementById("withdraw-valor").value);
        const numero = document.getElementById("withdraw-express").value;
        const msg = document.getElementById("withdraw-msg");

        const token = obterToken();
        const perfil = await obterUsuario();

        const { ok, dados } = await requestSeguro(`${BASE_URL}/api/withdraw`,{
            method:"POST",
            headers:{ "Content-Type":"application/json","Authorization":"Bearer "+token },
            body:JSON.stringify({ valor, numero_express:numero })
        });

        if(!ok){
            msg.style.color="red";
            msg.textContent = dados?.erro || "Erro";
            return;
        }

        msg.style.color="green";
        msg.textContent = dados.mensagem;
        carregarPainel();
    });
}

/* ===========================================================
   INICIALIZAÇÃO
=========================================================== */
document.addEventListener("DOMContentLoaded",()=>{
    document.getElementById("btn-login")?.addEventListener("click", login);
    document.getElementById("btn-registar")?.addEventListener("click", registrar);
    document.getElementById("btn-logout")?.addEventListener("click", sair);

    const path = window.location.pathname;
    if(path.endsWith("principal.html")) carregarPainel();
    if(path.endsWith("Historico.html")) carregarHistorico();
    if(path.endsWith("saque.html")) carregarSaque();
});
