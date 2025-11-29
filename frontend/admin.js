/**
 * ================================================
 *   GANHAPLUS - PAINEL ADMINISTRATIVO v3.0
 * ================================================
 */

<<<<<<< HEAD
const BASE_URL = 'https://ganhapluss-1.onrender.com';
;
=======
const BASE_URL = 'http://localhost:4000';
>>>>>>> 8806085 (Primeiro commit)
let ADMIN_SECRET = null; // não armazenar permanentemente

// Solicita admin secret ao entrar
async function solicitarAdminSecret() {
  let secret = prompt('Insira o ADMIN_SECRET:');
  if(!secret) {
    alert('ADMIN_SECRET necessário para acessar o painel.');
    return null;
  }
  return secret;
}

/* =========================
   TOASTS DE FEEDBACK
========================= */
function showToast(msg, tipo='info', duracao=2500){
  const toast = document.createElement('div');
  toast.className = `toast toast-${tipo}`;
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(()=>toast.remove(), duracao);
}

/* =========================
   API AUX
========================= */
async function apiGET(endpoint) {
  try {
    const res = await fetch(`${BASE_URL}${endpoint}`, { headers: {'x-admin-secret': ADMIN_SECRET} });
    const data = await res.json();
    if(!res.ok) throw new Error(data.erro||'Erro inesperado');
    return data;
  } catch(e){ console.error(e); throw e; }
}

async function apiPOST(endpoint, body){
  try{
    const res = await fetch(`${BASE_URL}${endpoint}`,{
      method:'POST',
      headers:{'Content-Type':'application/json','x-admin-secret':ADMIN_SECRET},
      body:JSON.stringify(body)
    });
    const data = await res.json();
    if(!res.ok) throw new Error(data.erro||'Erro inesperado');
    return data;
  } catch(e){ console.error(e); throw e; }
}

/* =========================
   CARREGAR SAQUES
========================= */
async function carregarSaques() {
  const container = document.getElementById('admin-saques');
  container.innerHTML = '<p>Carregando saques...</p>';
  try{
    const { saques } = await apiGET('/api/admin/saques');
    if(!saques.length){ container.innerHTML='<p>Nenhum saque pendente.</p>'; return; }

    container.innerHTML = '';
    saques.forEach(s=>{
      const card = document.createElement('div');
      card.className = 'card card-saque';
      card.innerHTML = `
        <div><strong>#${s.id} — ${s.telefone}</strong></div>
        <div>Valor: <b>${s.valor} AOA</b></div>
        <div>Status: <span class="status-badge ${s.status}">${s.status}</span></div>
        <div>Express: ${s.numero_express}</div>
        <button class="btn-pago" ${s.status==='pago'?'disabled':''}>Marcar como pago</button>
      `;
      const btn = card.querySelector('button');
      btn.addEventListener('click', ()=>marcarPago(s.id, card));
      container.appendChild(card);
    });
  }catch(e){
    container.innerHTML = `<p class="erro">Erro: ${e.message}</p>`;
  }
}

/* =========================
   CARREGAR USUÁRIOS
========================= */
async function carregarUsuarios() {
  const container = document.getElementById('admin-usuarios');
  container.innerHTML = '<p>Carregando usuários...</p>';
  try{
    const { usuarios } = await apiGET('/api/admin/usuarios');
    if(!usuarios.length){ container.innerHTML='<p>Nenhum usuário encontrado.</p>'; return; }

    container.innerHTML = '';
    usuarios.forEach(u=>{
      const card = document.createElement('div');
      card.className = 'card card-usuario';
      card.innerHTML = `
        <div>#${u.id} - ${u.telefone}</div>
        <div>Saldo: <b>${u.saldo} AOA</b></div>
        <div>Idade: ${u.idade}</div>
      `;
      container.appendChild(card);
    });
  }catch(e){
    container.innerHTML = `<p class="erro">Erro: ${e.message}</p>`;
  }
}

/* =========================
   MARCAR SAQUE COMO PAGO
========================= */
async function marcarPago(id, card){
  if(!confirm('Deseja realmente marcar este saque como pago?')) return;
  const btn = card.querySelector('button');
  btn.disabled = true;
  btn.textContent = 'Processando...';
  try{
    await apiPOST('/api/admin/markPaid', { saque_id: id });
    const statusEl = card.querySelector('.status-badge');
    statusEl.textContent = 'pago';
    statusEl.classList.remove('pendente');
    statusEl.classList.add('pago');
    btn.textContent = 'Pago ✔';
    showToast('Saque marcado como pago ✔', 'success');
  }catch(e){
    btn.disabled = false;
    btn.textContent = 'Marcar como pago';
    showToast(`Erro: ${e.message}`, 'error');
  }
}

/* =========================
   INICIALIZAÇÃO
========================= */
window.onload = async ()=>{
  ADMIN_SECRET = await solicitarAdminSecret();
  if(!ADMIN_SECRET) return;

  carregarSaques();
  carregarUsuarios();
};
