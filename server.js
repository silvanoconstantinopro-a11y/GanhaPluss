/**
 * ================================================
 *   GANHAPLUS - BACKEND PROFISSIONAL v5.1
 *   Node.js + Express + SQLite
 *   Recompensa:
 *     • Compartilhamento = 500 AOA
 *     • Anúncio = 500 AOA
 *   Sistema seguro e escalável para tarefas e saques
 * ================================================
 */

require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const path = require('path');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');

const app = express();

/* =========================
   CONFIGS GLOBAIS
========================= */
const PORT = process.env.PORT || 4000;

const CONFIG = {
    ADMIN_SECRET: process.env.ADMIN_SECRET || "ADMIN123",
    JWT_SECRET: process.env.JWT_SECRET || "JWT123",
    MIN_WITHDRAW: Number(process.env.MIN_WITHDRAW || 600000),
    MAX_TASKS_PER_DAY: Number(process.env.MAX_TASKS_PER_DAY || 60),
    REWARD_SHARE: 500,
    REWARD_AD: 500,
    WINDOW_24H: 24 * 60 * 60 * 1000
};

/* =========================
   MIDDLEWARES
========================= */
app.use(helmet());
app.use(cors());
app.use(bodyParser.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "frontend")));

app.use(rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 200,
    message: { erro: "Muitas requisições. Tente mais tarde." }
}));

/* =========================
   BANCO DE DADOS
========================= */
const dbFile = path.join(__dirname, "database.sqlite");
const db = new sqlite3.Database(dbFile);

db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS usuarios (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            telefone TEXT UNIQUE NOT NULL,
            senha_hash TEXT NOT NULL,
            idade INTEGER NOT NULL,
            saldo INTEGER DEFAULT 0,
            criado_em DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS historico (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            usuario_id INTEGER NOT NULL,
            tipo TEXT NOT NULL,
            descricao TEXT,
            valor INTEGER NOT NULL,
            anuncio_id TEXT,
            criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS saques (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            usuario_id INTEGER NOT NULL,
            valor INTEGER NOT NULL,
            numero_express TEXT NOT NULL,
            status TEXT DEFAULT 'pendente',
            criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
            pago_em DATETIME,
            FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS compartilhamentos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            usuario_id INTEGER NOT NULL,
            link_id TEXT NOT NULL,
            plataforma TEXT NOT NULL,
            valor INTEGER NOT NULL,
            criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
        )
    `);
});

/* =========================
   FUNÇÕES AUXILIARES
========================= */
const gerarToken = u =>
    jwt.sign({ id: u.id, telefone: u.telefone }, CONFIG.JWT_SECRET, { expiresIn: "7d" });

const erro = (res, c, m) => res.status(c).json({ sucesso: false, erro: m });

/* =========================
   MIDDLEWARE AUTENTICAÇÃO
========================= */
function auth(req, res, next) {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) return erro(res, 401, "Token ausente");
    jwt.verify(token, CONFIG.JWT_SECRET, (e, d) => {
        if (e) return erro(res, 403, "Token inválido");
        req.usuario = d;
        next();
    });
}

function admin(req, res, next) {
    if (req.headers["x-admin-secret"] !== CONFIG.ADMIN_SECRET)
        return erro(res, 403, "Acesso proibido");
    next();
}

/* =========================
   ROTAS FRONTEND
========================= */
app.get("/", (_, res) =>
    res.sendFile(path.join(__dirname, "frontend", "login.html"))
);

/* =========================
   AUTENTICAÇÃO
========================= */
app.post("/api/register", async (req, res) => {
    try {
        const { telefone, senha, idade } = req.body;

        if (!telefone || !senha || !idade)
            return erro(res, 400, "Preencha todos os campos");

        if (senha.length < 4)
            return erro(res, 400, "Senha muito curta");

        if (idade < 18)
            return erro(res, 400, "Apenas maiores de 18 anos");

        const hash = await bcrypt.hash(senha, 12);

        db.run(
            `INSERT INTO usuarios (telefone, senha_hash, idade) VALUES (?, ?, ?)`,
            [telefone, hash, idade],
            function (err) {
                if (err) {
                    if (err.message.includes("UNIQUE"))
                        return erro(res, 400, "Telefone já registado");
                    return erro(res, 500, "Erro ao criar usuário");
                }

                const usuario = { id: this.lastID, telefone };
                res.json({
                    sucesso: true,
                    token: gerarToken(usuario),
                    usuario
                });
            }
        );
    } catch (e) {
        console.log(e);
        erro(res, 500, "Erro interno");
    }
});

app.post("/api/login", (req, res) => {
    const { telefone, senha } = req.body;

    db.get(
        `SELECT * FROM usuarios WHERE telefone=?`,
        [telefone],
        async (err, row) => {
            if (!row) return erro(res, 401, "Credenciais inválidas");

            const ok = await bcrypt.compare(senha, row.senha_hash);
            if (!ok) return erro(res, 401, "Credenciais inválidas");

            res.json({
                sucesso: true,
                token: gerarToken(row),
                usuario: { id: row.id, telefone: row.telefone, saldo: row.saldo }
            });
        }
    );
});

/* =========================
   SALDO & HISTÓRICO
========================= */
app.get("/api/saldo/:id", auth, (req, res) => {
    if (Number(req.params.id) !== req.usuario.id)
        return erro(res, 403, "Acesso negado");

    db.get(
        `SELECT saldo FROM usuarios WHERE id=?`,
        [req.usuario.id],
        (_, row) =>
            res.json({ sucesso: true, saldo: row?.saldo || 0 })
    );
});

/* =========================
   TAREFAS / ANÚNCIOS
========================= */
app.post("/api/tarefa", auth, (req, res) => {
    const { tipo, descricao, valor, anuncio_id } = req.body;

    if (!tipo || !descricao || !valor || !anuncio_id)
        return erro(res, 400, "Dados incompletos");

    const user = req.usuario.id;
    const hoje = new Date().toISOString().slice(0, 10);

    db.get(
        `SELECT COUNT(*) AS qtd FROM historico WHERE usuario_id=? AND tipo=? AND DATE(criado_em)=?`,
        [user, tipo, hoje],
        (err, row) => {
            if (row.qtd >= CONFIG.MAX_TASKS_PER_DAY)
                return erro(res, 400, "Limite diário atingido");

            db.serialize(() => {
                db.run(`UPDATE usuarios SET saldo = saldo + ? WHERE id=?`, [
                    valor,
                    user
                ]);

                db.run(
                    `INSERT INTO historico (usuario_id, tipo, descricao, valor, anuncio_id)
                    VALUES (?, ?, ?, ?, ?)`,
                    [user, tipo, descricao, valor, anuncio_id]
                );

                db.get(
                    `SELECT saldo FROM usuarios WHERE id=?`,
                    [user],
                    (_, r) =>
                        res.json({
                            sucesso: true,
                            mensagem: "Tarefa registrada",
                            saldo_atual: r.saldo
                        })
                );
            });
        }
    );
});

/* =========================
   COMPARTILHAMENTO (500 AOA)
========================= */
app.post("/api/compartilhar", auth, (req, res) => {
    const { link_id, plataforma } = req.body;

    if (!link_id || !plataforma)
        return erro(res, 400, "Dados incompletos");

    const user = req.usuario.id;
    const limite = new Date(Date.now() - CONFIG.WINDOW_24H).toISOString();

    db.get(
        `SELECT COUNT(*) AS qtd FROM compartilhamentos WHERE usuario_id=? AND criado_em > ?`,
        [user, limite],
        (err, row) => {
            if (row.qtd > 0)
                return erro(res, 429, "Aguarde 24h para novo compartilhamento");

            db.serialize(() => {
                db.run(
                    `UPDATE usuarios SET saldo = saldo + ? WHERE id=?`,
                    [CONFIG.REWARD_SHARE, user]
                );

                db.run(
                    `INSERT INTO compartilhamentos (usuario_id, link_id, plataforma, valor)
                    VALUES (?, ?, ?, ?)`,
                    [user, link_id, plataforma, CONFIG.REWARD_SHARE]
                );

                db.run(
                    `INSERT INTO historico (usuario_id, tipo, descricao, valor)
                    VALUES (?, ?, ?, ?)`,
                    [
                        user,
                        "compartilhamento",
                        `Compartilhado em ${plataforma}`,
                        CONFIG.REWARD_SHARE
                    ]
                );

                db.get(
                    `SELECT saldo FROM usuarios WHERE id=?`,
                    [user],
                    (_, r) =>
                        res.json({
                            sucesso: true,
                            mensagem: "Compartilhamento registrado",
                            saldo_atual: r.saldo
                        })
                );
            });
        }
    );
});

/* =========================
   SAQUES
========================= */
app.post("/api/withdraw", auth, (req, res) => {
    const { valor, numero_express } = req.body;
    const user = req.usuario.id;

    if (!valor || !numero_express)
        return erro(res, 400, "Dados incompletos");

    if (valor < CONFIG.MIN_WITHDRAW)
        return erro(
            res,
            400,
            `Valor mínimo: ${CONFIG.MIN_WITHDRAW} AOA`
        );

    db.get(
        `SELECT saldo FROM usuarios WHERE id=?`,
        [user],
        (err, row) => {
            if (row.saldo < valor)
                return erro(res, 400, "Saldo insuficiente");

            db.serialize(() => {
                db.run(
                    `INSERT INTO saques (usuario_id, valor, numero_express)
                    VALUES (?, ?, ?)`,
                    [user, valor, numero_express],
                    function () {
                        db.run(
                            `UPDATE usuarios SET saldo = saldo - ? WHERE id=?`,
                            [valor, user]
                        );

                        db.run(
                            `INSERT INTO historico (usuario_id, tipo, descricao, valor)
                            VALUES (?, ?, ?, ?)`,
                            [user, "saque", `Saque #${this.lastID}`, -valor]
                        );

                        db.get(
                            `SELECT saldo FROM usuarios WHERE id=?`,
                            [user],
                            (_, r) =>
                                res.json({
                                    sucesso: true,
                                    mensagem: "Pedido enviado",
                                    saldo_atual: r.saldo
                                })
                        );
                    }
                );
            });
        }
    );
});

/* =========================
   ADMIN
========================= */
app.get("/api/admin/saques", admin, (_, res) => {
    db.all(
        `SELECT s.*, u.telefone FROM saques s
        JOIN usuarios u ON u.id = s.usuario_id
        ORDER BY criado_em DESC`,
        (_, rows) => res.json({ sucesso: true, saques: rows })
    );
});

app.post("/api/admin/markPaid", admin, (req, res) => {
    const { saque_id } = req.body;

    db.run(
        `UPDATE saques SET status='pago', pago_em=CURRENT_TIMESTAMP WHERE id=?`,
        [saque_id],
        function () {
            if (this.changes === 0)
                return erro(res, 404, "Saque não encontrado");

            res.json({ sucesso: true, mensagem: "Marcado como pago" });
        }
    );
});

/* =========================
   INICIAR SERVIDOR
========================= */
app.listen(PORT, () =>
    console.log(`🚀 Servidor ativo na porta ${PORT}`)
);
