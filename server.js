/*******************************************************************************************
 * GANHAPLUS — BACKEND PROFISSIONAL PRO MAX v6.0
 * Node.js + Express + SQLite (arquivo único)
 *
 * Segurança reforçada • Performance otimizada • Arquitetura limpa
 *
 * Ambiente .env recomendado:
 *  - ADMIN_SECRET=
 *  - JWT_SECRET=
 *  - PORT=
 *  - MIN_WITHDRAW=
 *  - ALLOWED_ORIGINS=https://seusite.com,https://painel.com
 *******************************************************************************************/

require("dotenv").config();
const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const cors = require("cors");
const helmet = require("helmet");
const path = require("path");
const morgan = require("morgan");
const rateLimit = require("express-rate-limit");

const app = express();

/* ===========================================================
   CONFIGURAÇÕES GLOBAIS
   =========================================================== */
const PORT = process.env.PORT || 4000;
const CONFIG = {
  ADMIN_SECRET: process.env.ADMIN_SECRET || "ADMIN123",
  JWT_SECRET: process.env.JWT_SECRET || "JWT123",
  MIN_WITHDRAW: Number(process.env.MIN_WITHDRAW || 600000),
  MAX_ADS_PER_DAY: Number(process.env.MAX_ADS_PER_DAY || 60),
  MAX_SHARES_PER_DAY: Number(process.env.MAX_SHARES_PER_DAY || 60),
  REWARD_SHARE: Number(process.env.REWARD_SHARE || 250),
  REWARD_AD: Number(process.env.REWARD_AD || 500),
  WINDOW_24H_MS: 24 * 60 * 60 * 1000,
  JWT_EXPIRES: "7d",
  SALT_ROUNDS: 12,
  ALLOWED_ORIGINS:
    (process.env.ALLOWED_ORIGINS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean) || [],
};

/* ===========================================================
   MIDDLEWARES
   =========================================================== */
app.use(
  helmet({
    crossOriginEmbedderPolicy: false,
    contentSecurityPolicy: false,
  })
);

app.use(express.json({ limit: "4mb" }));
app.use(morgan("dev"));

/* -------- CORS -------- */
const corsOptions =
  CONFIG.ALLOWED_ORIGINS.length === 0
    ? {} // Em dev, libera tudo
    : {
        origin: (origin, cb) => {
          if (!origin) return cb(null, true);
          if (CONFIG.ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
          return cb(new Error("CORS bloqueado"));
        },
      };

app.use(cors(corsOptions));

/* -------- Rate Limiter Pro -------- */
app.use(
  rateLimit({
    windowMs: 10 * 60 * 1000,
    max: 500,
    standardHeaders: true,
    legacyHeaders: false,
    message: { sucesso: false, erro: "Muitas requisições. Aguarde." },
  })
);

/* -------- Servir Frontend -------- */
app.use(express.static(path.join(__dirname, "frontend")));

/* ===========================================================
   BANCO DE DADOS - SQLite (Promisified)
   =========================================================== */
const db = new sqlite3.Database(path.join(__dirname, "database.sqlite"));

const dbRun = (...args) =>
  new Promise((resolve, reject) =>
    db.run(...args, function (err) {
      if (err) reject(err);
      else resolve(this);
    })
  );

const dbGet = (...args) =>
  new Promise((resolve, reject) =>
    db.get(...args, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    })
  );

const dbAll = (...args) =>
  new Promise((resolve, reject) =>
    db.all(...args, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    })
  );

/* ===========================================================
   CRIAÇÃO DAS TABELAS
   =========================================================== */
(async () => {
  await dbRun(`CREATE TABLE IF NOT EXISTS usuarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telefone TEXT UNIQUE NOT NULL,
    senha_hash TEXT NOT NULL,
    idade INTEGER NOT NULL,
    saldo INTEGER DEFAULT 0,
    criado_em DATETIME DEFAULT (datetime('now'))
  )`);

  await dbRun(`CREATE TABLE IF NOT EXISTS historico (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id INTEGER NOT NULL,
    tipo TEXT NOT NULL,
    descricao TEXT,
    valor INTEGER NOT NULL,
    anuncio_id TEXT,
    criado_em DATETIME DEFAULT (datetime('now')),
    FOREIGN KEY(usuario_id) REFERENCES usuarios(id)
  )`);

  await dbRun(`CREATE TABLE IF NOT EXISTS saques (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id INTEGER NOT NULL,
    valor INTEGER NOT NULL,
    numero_express TEXT NOT NULL,
    status TEXT DEFAULT 'pendente',
    criado_em DATETIME DEFAULT (datetime('now')),
    pago_em DATETIME,
    FOREIGN KEY(usuario_id) REFERENCES usuarios(id)
  )`);

  await dbRun(`CREATE TABLE IF NOT EXISTS compartilhamentos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id INTEGER NOT NULL,
    link_id TEXT NOT NULL,
    plataforma TEXT NOT NULL,
    valor INTEGER NOT NULL,
    criado_em DATETIME DEFAULT (datetime('now')),
    FOREIGN KEY(usuario_id) REFERENCES usuarios(id)
  )`);

  console.log("📦 Banco de dados pronto.");
})();

/* ===========================================================
   FUNÇÕES AUXILIARES
   =========================================================== */
const erro = (res, msg, status = 400) =>
  res.status(status).json({ sucesso: false, erro: msg });

const gerarToken = (user) =>
  jwt.sign({ id: user.id, telefone: user.telefone }, CONFIG.JWT_SECRET, {
    expiresIn: CONFIG.JWT_EXPIRES,
  });

const validarTelefone = (t) => {
  if (!t) return false;
  const n = t.replace(/\D/g, "");
  return n.length >= 8 && n.length <= 15;
};

/* ===========================================================
   MIDDLEWARES DE AUTENTICAÇÃO
   =========================================================== */
const auth = (req, res, next) => {
  const header = req.headers.authorization;
  if (!header) return erro(res, "Token ausente", 401);

  const token = header.split(" ")[1];
  if (!token) return erro(res, "Token malformatado", 401);

  jwt.verify(token, CONFIG.JWT_SECRET, (err, dec) => {
    if (err) return erro(res, "Token inválido", 403);
    req.usuario = dec;
    next();
  });
};

const admin = (req, res, next) => {
  if (req.headers["x-admin-secret"] !== CONFIG.ADMIN_SECRET)
    return erro(res, "Acesso negado", 403);
  next();
};

/* ===========================================================
   ROTAS FRONTEND
   =========================================================== */
app.get("/", (_, res) =>
  res.sendFile(path.join(__dirname, "frontend", "login.html"))
);

/* ===========================================================
   ROTAS — AUTENTICAÇÃO
   =========================================================== */
app.post("/api/register", async (req, res) => {
  try {
    const { telefone, senha, idade } = req.body;

    if (!telefone || !senha || !idade) return erro(res, "Campos faltando");
    if (!validarTelefone(telefone)) return erro(res, "Telefone inválido");
    if (senha.length < 6) return erro(res, "Senha muito curta");
    if (+idade < 18) return erro(res, "Apenas maiores de 18 anos");

    const hash = await bcrypt.hash(senha, CONFIG.SALT_ROUNDS);

    try {
      const r = await dbRun(
        "INSERT INTO usuarios (telefone, senha_hash, idade) VALUES (?, ?, ?)",
        [telefone, hash, idade]
      );
      const u = { id: r.lastID, telefone };
      return res.json({ sucesso: true, token: gerarToken(u), usuario: u });
    } catch (e) {
      if (e.code === "SQLITE_CONSTRAINT")
        return erro(res, "Telefone já registado");
      throw e;
    }
  } catch (e) {
    console.error(e);
    return erro(res, "Erro interno", 500);
  }
});

app.post("/api/login", async (req, res) => {
  try {
    const { telefone, senha } = req.body;
    if (!telefone || !senha) return erro(res, "Campos faltando");

    const row = await dbGet("SELECT * FROM usuarios WHERE telefone = ?", [
      telefone,
    ]);
    if (!row) return erro(res, "Credenciais inválidas", 401);

    const ok = await bcrypt.compare(senha, row.senha_hash);
    if (!ok) return erro(res, "Credenciais inválidas", 401);

    return res.json({
      sucesso: true,
      token: gerarToken(row),
      usuario: { id: row.id, telefone: row.telefone, saldo: row.saldo },
    });
  } catch (e) {
    console.error(e);
    return erro(res, "Erro interno", 500);
  }
});

/* ===========================================================
   SALDO & HISTÓRICO
   =========================================================== */
app.get("/api/saldo/:id", auth, async (req, res) => {
  const id = +req.params.id;
  if (id !== req.usuario.id) return erro(res, "Acesso negado", 403);

  const r = await dbGet("SELECT saldo FROM usuarios WHERE id = ?", [id]);
  return res.json({ sucesso: true, saldo: r?.saldo ?? 0 });
});

app.get("/api/historico/:id", auth, async (req, res) => {
  const id = +req.params.id;
  if (id !== req.usuario.id) return erro(res, "Acesso negado", 403);

  const rows = await dbAll(
    `SELECT * FROM historico WHERE usuario_id = ?
     ORDER BY criado_em DESC LIMIT 200`,
    [id]
  );

  return res.json({ sucesso: true, historico: rows });
});

/* ===========================================================
   TAREFAS / ANÚNCIOS SEGUROS
   =========================================================== */
app.post("/api/tarefa", auth, async (req, res) => {
  const { tipo, descricao, valor, anuncio_id } = req.body;
  const userId = req.usuario.id;

  if (!tipo) return erro(res, "Tipo obrigatório");

  const tipoNorm = String(tipo).toLowerCase();

  if (tipoNorm === "anuncio") {
    if (!anuncio_id) return erro(res, "Anúncio inválido");
    const hoje = new Date().toISOString().slice(0, 10);

    const qtd = await dbGet(
      "SELECT COUNT(*) qtd FROM historico WHERE usuario_id=? AND tipo='anuncio' AND date(criado_em)=date(?)",
      [userId, hoje]
    );

    if (qtd?.qtd >= CONFIG.MAX_ADS_PER_DAY)
      return erro(res, "Limite diário de anúncios atingido");

    try {
      await dbRun("BEGIN");

      await dbRun(
        "UPDATE usuarios SET saldo = saldo + ? WHERE id=?",
        [CONFIG.REWARD_AD / 4, userId]
      );

      await dbRun(
        "INSERT INTO historico(usuario_id,tipo,descricao,valor,anuncio_id) VALUES(?,?,?,?,?)",
        [userId, "anuncio", descricao || anuncio_id, CONFIG.REWARD_AD / 4, anuncio_id]
      );

      await dbRun("COMMIT");
    } catch (e) {
      await dbRun("ROLLBACK");
      return erro(res, "Erro ao registrar anúncio", 500);
    }

    const saldo = await dbGet("SELECT saldo FROM usuarios WHERE id=?", [userId]);
    return res.json({ sucesso: true, saldo_atual: saldo.saldo });
  }

  // Compartilhamento ou outro
  if (!descricao || !valor) return erro(res, "Dados incompletos");

  const limite =
    tipoNorm === "compartilhamento"
      ? CONFIG.MAX_SHARES_PER_DAY
      : CONFIG.MAX_ADS_PER_DAY;

  const hoje = new Date().toISOString().slice(0, 10);
  const qtd = await dbGet(
    `SELECT COUNT(*) qtd FROM historico
     WHERE usuario_id=? AND tipo=? AND date(criado_em)=date(?)`,
    [userId, tipoNorm, hoje]
  );

  if (qtd?.qtd >= limite)
    return erro(res, "Limite diário atingido");

  try {
    await dbRun("BEGIN");

    await dbRun(
      "UPDATE usuarios SET saldo = saldo + ? WHERE id = ?",
      [valor, userId]
    );

    await dbRun(
      `INSERT INTO historico (usuario_id, tipo, descricao, valor, anuncio_id)
       VALUES (?, ?, ?, ?, ?)`,
      [userId, tipoNorm, descricao, valor, anuncio_id || null]
    );

    await dbRun("COMMIT");
  } catch (e) {
    await dbRun("ROLLBACK");
    return erro(res, "Erro ao registrar tarefa", 500);
  }

  const saldo = await dbGet("SELECT saldo FROM usuarios WHERE id=?", [userId]);
  return res.json({ sucesso: true, saldo_atual: saldo.saldo });
});

/* ===========================================================
   COMPARTILHAMENTO
   =========================================================== */
app.post("/api/compartilhar", auth, async (req, res) => {
  const { link_id, plataforma } = req.body;
  const userId = req.usuario.id;

  if (!link_id || !plataforma) return erro(res, "Dados faltando");

  const limite = new Date(Date.now() - CONFIG.WINDOW_24H_MS).toISOString();

  const row = await dbGet(
    `SELECT COUNT(*) qtd FROM compartilhamentos
     WHERE usuario_id = ? AND criado_em > ?`,
    [userId, limite]
  );

  if (row?.qtd > 0)
    return erro(res, "Você deve aguardar 24h entre compartilhamentos", 429);

  try {
    await dbRun("BEGIN");

    await dbRun(
      "UPDATE usuarios SET saldo = saldo + ? WHERE id = ?",
      [CONFIG.REWARD_SHARE, userId]
    );

    await dbRun(
      `INSERT INTO compartilhamentos (usuario_id, link_id, plataforma, valor)
       VALUES (?, ?, ?, ?)`,
      [userId, link_id, plataforma, CONFIG.REWARD_SHARE]
    );

    await dbRun(
      `INSERT INTO historico (usuario_id, tipo, descricao, valor)
       VALUES (?, 'compartilhamento', ?, ?)`,
      [userId, `Compartilhado em ${plataforma}`, CONFIG.REWARD_SHARE]
    );

    await dbRun("COMMIT");
  } catch (e) {
    await dbRun("ROLLBACK");
    return erro(res, "Erro ao registrar compartilhamento", 500);
  }

  const saldo = await dbGet("SELECT saldo FROM usuarios WHERE id = ?", [userId]);

  return res.json({
    sucesso: true,
    mensagem: "Compartilhamento registrado",
    saldo_atual: saldo.saldo,
  });
});

/* ===========================================================
   SAQUES
   =========================================================== */
app.post("/api/withdraw", auth, async (req, res) => {
  const { valor, numero_express } = req.body;
  const userId = req.usuario.id;

  if (!valor || !numero_express) return erro(res, "Dados incompletos");
  if (valor < CONFIG.MIN_WITHDRAW)
    return erro(res, `Valor mínimo de saque: ${CONFIG.MIN_WITHDRAW}`);

  const saldo = await dbGet("SELECT saldo FROM usuarios WHERE id = ?", [userId]);
  if (!saldo || saldo.saldo < valor) return erro(res, "Saldo insuficiente");

  try {
    await dbRun("BEGIN");

    const insert = await dbRun(
      `INSERT INTO saques (usuario_id, valor, numero_express)
       VALUES (?, ?, ?)`,
      [userId, valor, numero_express]
    );

    await dbRun("UPDATE usuarios SET saldo = saldo - ? WHERE id = ?", [valor, userId]);

    await dbRun(
      `INSERT INTO historico (usuario_id, tipo, descricao, valor)
       VALUES (?, 'saque', ?, ?)`,
      [userId, `Saque #${insert.lastID}`, -valor]
    );

    await dbRun("COMMIT");
  } catch (e) {
    await dbRun("ROLLBACK");
    return erro(res, "Erro ao solicitar saque", 500);
  }

  const novoSaldo = await dbGet("SELECT saldo FROM usuarios WHERE id = ?", [userId]);
  return res.json({
    sucesso: true,
    mensagem: "Pedido de saque enviado",
    saldo_atual: novoSaldo.saldo,
  });
});

/* ===========================================================
   ADMIN
   =========================================================== */
app.get("/api/admin/saques", admin, async (req, res) => {
  const rows = await dbAll(
    `SELECT s.*, u.telefone
     FROM saques s
     JOIN usuarios u ON u.id = s.usuario_id
     ORDER BY s.criado_em DESC
     LIMIT 1000`
  );
  res.json({ sucesso: true, saques: rows });
});

app.post("/api/admin/markPaid", admin, async (req, res) => {
  const { saque_id } = req.body;
  if (!saque_id) return erro(res, "saque_id obrigatório");

  const r = await dbRun(
    `UPDATE saques
     SET status='pago', pago_em=datetime('now')
     WHERE id = ? AND status='pendente'`,
    [saque_id]
  );

  if (r.changes === 0) return erro(res, "Saque inexistente ou já pago", 404);

  res.json({ sucesso: true, mensagem: "Saque marcado como pago" });
});

/* ===========================================================
   LISTEN
   =========================================================== */
app.listen(PORT, () =>
  console.log(`🚀 GanhaPlus PRO MAX rodando na porta ${PORT}`)
);
