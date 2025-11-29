// ================================
// APP.JS — GanhaPlus Pro Max v6.2
// ================================

// CONFIGURAÇÕES
const BASE_URL = "https://ganhaplus.onrender.com"; // Se o frontend estiver servido pelo mesmo server.js
const TOKEN_KEY = "gp_token";
const REWARD_AD = 500;      // Ganho total por 4 anúncios
const REWARD_SHARE = 250;   // Ganho por compartilhamento
const MAX_ADS_PER_SEQUENCE = 4;
const REQUEST_TIMEOUT_MS = 15000;

// ------------------ TOASTS ------------------
function ensureToastContainer() {
  let c = document.getElementById("gp-toast-container");
  if (!c) {
    c = document.createElement("div");
    c.id = "gp-toast-container";
    c.style.position = "fixed";
    c.style.top = "16px";
    c.style.right = "16px";
    c.style.zIndex = "999999";
    c.style.display = "flex";
    c.style.flexDirection = "column";
    c.style.gap = "8px";
    document.body.appendChild(c);
  }
  return c;
}

function showToast(msg, { type = "info", duration = 4000 } = {}) {
  const c = ensureToastContainer();
  const el = document.createElement("div");
  el.textContent = msg;
  el.style.padding = "10px 14px";
  el.style.borderRadius = "8px";
  el.style.background = type === "error" ? "#ffe5e5" : type === "success" ? "#e5fff2" : "#e9f0ff";
  el.style.boxShadow = "0 6px 18px rgba(0,0,0,0.12)";
  el.style.opacity = "1";
  el.style.transition = "opacity 0.25s";
  c.appendChild(el);
  setTimeout(() => { el.style.opacity = "0"; setTimeout(() => el.remove(), 260); }, duration);
}

// ------------------ TOKEN ------------------
function salvarToken(token) { localStorage.setItem(TOKEN_KEY, token); }
function obterToken() { return localStorage.getItem(TOKEN_KEY); }
function limparToken() { localStorage.removeItem(TOKEN_KEY); }

function parseJwt(t) {
  try { return JSON.parse(atob(t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))); } catch { return null; }
}

function tokenValido(t) {
  const p = parseJwt(t);
  return p?.exp && p.exp > Date.now() / 1000;
}

async function obterUsuario() {
  const t = obterToken();
  if (!t || !tokenValido(t)) { limparToken(); return null; }
  return parseJwt(t);
}

// ------------------ REQUEST SEGURO ------------------
async function requestSeguro(path, opts = {}) {
  const url = path.startsWith("http") ? path : BASE_URL + path;
  const token = obterToken();
  const headers = opts.headers || {};
  if (!headers["Content-Type"] && !(opts.body instanceof FormData)) headers["Content-Type"] = "application/json";
  if (token) headers["Authorization"] = "Bearer " + token;

  const ctrl = new AbortController();
  const tout = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(url, { ...opts, headers, signal: ctrl.signal });
    clearTimeout(tout);
    const txt = await res.text();
    let dados = {};
    try { dados = txt ? JSON.parse(txt) : {}; } catch {}

    if ((res.status === 401 || res.status === 403) && token) {
      limparToken();
      showToast("Sessão expirada.", { type: "error" });
    }
    return { ok: res.ok, status: res.status, dados };
  } catch {
    clearTimeout(tout);
    return { ok: false, status: 0, dados: { erro: "Falha de conexão" } };
  }
}

// ------------------ BOTÕES ------------------
function disableBtn(btn, txt = "Aguarde...") { if (!btn) return; btn._old = btn.innerHTML; btn.disabled = true; btn.innerHTML = txt; }
function enableBtn(btn) { if (!btn) return; btn.disabled = false; if (btn._old) btn.innerHTML = btn._old; }

// ------------------ LOGIN ------------------
async function login() {
  const tel = document.getElementById("login-telefone")?.value?.trim();
  const sen = document.getElementById("login-senha")?.value;
  if (!tel || !sen) return showToast("Preencha todos campos", { type: "error" });

  const btn = document.getElementById("btn-login");
  disableBtn(btn);

  const { ok, dados } = await requestSeguro("/api/login", {
    method: "POST", body: JSON.stringify({ telefone: tel, senha: sen })
  });

  enableBtn(btn);

  if (!ok || !dados.token) return showToast(dados?.erro || "Login falhou", { type: "error" });

  salvarToken(dados.token);
  showToast("Login OK", { type: "success" });
  location.href = "principal.html";
}

// ------------------ REGISTRO ------------------
async function registrar() {
  const tel = document.getElementById("reg-telefone")?.value?.trim();
  const sen = document.getElementById("reg-senha")?.value;
  const idade = Number(document.getElementById("reg-idade")?.value);
  if (!tel || !sen || !idade) return showToast("Preencha tudo", { type: "error" });
  if (idade < 18) return showToast("Apenas maiores de 18", { type: "error" });

  const btn = document.getElementById("btn-registar");
  disableBtn(btn);

  const { ok, dados } = await requestSeguro("/api/register", {
    method: "POST", body: JSON.stringify({ telefone: tel, senha: sen, idade })
  });

  enableBtn(btn);

  if (!ok || !dados.token) return showToast(dados?.erro || "Erro", { type: "error" });

  salvarToken(dados.token);
  showToast("Registado!", { type: "success" });
  location.href = "principal.html";
}

// ------------------ PAINEL ------------------
async function carregarPainel() {
  const u = await obterUsuario();
  if (!u) return sair(false);

  const { ok, dados } = await requestSeguro(`/api/saldo/${u.id}`);
  if (!ok) return showToast("Erro saldo", { type: "error" });

  document.getElementById("saldo-valor").textContent = (dados.saldo || 0) + " AOA";

  const btnA = document.getElementById("btn-assistir");
  if (btnA && !btnA.dataset.bound) { btnA.dataset.bound = 1; btnA.addEventListener("click", () => abrirSequenciaAnuncios(btnA)); }

  const btnC = document.getElementById("btn-compartilhar");
  if (btnC && !btnC.dataset.bound) { btnC.dataset.bound = 1; btnC.addEventListener("click", () => compartilhar(btnC)); }
}

// ------------------ ANÚNCIOS SEGUROS ------------------
async function abrirSequenciaAnuncios(btn) {
  disableBtn(btn, "Carregando anúncios...");
  const u = await obterUsuario();
  if (!u) return sair();

  // Inicializa sequência de anúncios no backend
  const { ok, dados } = await requestSeguro(`/api/tarefa/anuncio/init`, {
    method: "POST",
    body: JSON.stringify({ userId: u.id })
  });

  if (!ok || !dados?.anuncios || !dados.anuncios.length) {
    showToast("Os anúncios não estão disponíveis. Tente mais tarde.", { type: "error" });
    enableBtn(btn);
    return;
  }

  showToast("Anúncios carregados! Assista todos para receber a recompensa.", { type: "info" });

  // Recompensa só é creditada após o backend confirmar que todos os anúncios foram assistidos
  // O backend deve validar tempo de visualização real de cada anúncio
  enableBtn(btn);
}

// ------------------ COMPARTILHAR SEGURO ------------------
async function compartilhar(btn) {
  const u = await obterUsuario();
  if (!u) return sair();

  // Solicita link de compartilhamento
  const { ok, dados } = await requestSeguro("/api/compartilhar/init", {
    method: "POST",
    body: JSON.stringify({ userId: u.id })
  });

  if (!ok || !dados?.link_id) {
    showToast("Não foi possível gerar link de compartilhamento.", { type: "error" });
    return;
  }

  showToast("Link de compartilhamento gerado. Recompensa só será creditada após alguém clicar.", { type: "info" });
}

// ------------------ HISTÓRICO ------------------
async function carregarHistorico() {
  const u = await obterUsuario();
  if (!u) return;

  const { ok, dados } = await requestSeguro(`/api/historico/${u.id}`);
  if (!ok) return showToast("Erro ao carregar histórico", { type: "error" });

  const list = document.getElementById("historico-lista");
  if (!list) return;

  list.innerHTML = (dados.historico || []).map(h => `
    <div class="card historico-item">
      <strong>${h.tipo}</strong> - ${h.valor} AOA<br>
      <small>${h.descricao}</small>
    </div>
  `).join("");
}

// ------------------ SAQUE ------------------
function configurarSaque() {
  const btn = document.getElementById("btn-withdraw");
  if (!btn || btn.dataset.bound) return;
  btn.dataset.bound = 1;

  btn.addEventListener("click", async () => {
    const valor = Number(document.getElementById("withdraw-valor")?.value);
    const numero = document.getElementById("withdraw-express")?.value?.trim();
    if (!valor || !numero) return showToast("Preencha tudo", { type: "error" });

    disableBtn(btn);
    const { ok, dados } = await requestSeguro("/api/withdraw", {
      method: "POST",
      body: JSON.stringify({ valor, numero_express: numero })
    });
    enableBtn(btn);

    showToast(ok ? "Pedido de saque enviado" : dados?.erro || "Erro", { type: ok ? "success" : "error" });
    if (ok) carregarPainel();
  });
}

// ------------------ LOGOUT ------------------
function sair(redir = true) {
  limparToken();
  if (redir) location.href = "login.html";
}

// ------------------ INIT ------------------
document.addEventListener("DOMContentLoaded", () => {

  /* --- MENU LATERAL --- */
  const sidebar = document.getElementById("sidebar");
  const toggleBtn = document.getElementById("toggle-sidebar");
  toggleBtn?.addEventListener("click", () => sidebar.classList.toggle("sidebar-hidden"));

  /* --- LOGOUT (2 botões sincronizados) --- */
  const logoutNow = () => { localStorage.removeItem("gp_token"); window.location.href = "login.html"; };
  document.getElementById("btn-logout")?.addEventListener("click", logoutNow);
  document.getElementById("btn-logout-2")?.addEventListener("click", logoutNow);

  /* --- ASSISTIR ANÚNCIOS --- */
  const assistirBtn = document.getElementById("btn-assistir");
  assistirBtn?.addEventListener("click", async () => {
    if (typeof abrirSequenciaAnuncios !== "function") {
      showToast("Erro: sistema de anúncios não carregou.", { type: "error" });
      return;
    }
    disableBtn(assistirBtn, "Carregando anúncios...");
    try { await abrirSequenciaAnuncios(assistirBtn); carregarPainel?.(); carregarHistorico?.(); }
    catch { showToast("Não foi possível exibir anúncios. Tente novamente.", { type: "error" }); }
    finally { enableBtn(assistirBtn); }
  });

  /* --- COMPARTILHAR --- */
  const compartilharBtn = document.getElementById("btn-compartilhar");
  compartilharBtn?.addEventListener("click", async () => {
    if (typeof compartilhar !== "function") { showToast("Faça login para partilhar.", { type: "error" }); return; }
    disableBtn(compartilharBtn, "Registrando...");
    try { await compartilhar(compartilharBtn); carregarPainel?.(); carregarHistorico?.(); }
    catch { showToast("Não foi possível registrar a partilha.", { type: "error" }); }
    finally { enableBtn(compartilharBtn); }
  });

  /* --- LOGIN / REGISTRO / SAQUE --- */
  document.getElementById("btn-login")?.addEventListener("click", login);
  document.getElementById("btn-registar")?.addEventListener("click", registrar);
  if (location.pathname.split("/").pop() === "saque.html") { carregarPainel(); configurarSaque(); }
  if (location.pathname.split("/").pop() === "historico.html") carregarHistorico();
  if (location.pathname.split("/").pop() === "principal.html") carregarPainel();
});
