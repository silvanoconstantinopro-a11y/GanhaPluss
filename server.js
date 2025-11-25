/**
 * ================================================
 *   GANHAPLUS - BACKEND PROFISSIONAL v5.0 (PT)
 *   Node.js + Express + SQLite
 *   Recompensa:
 *     - Compartilhamento = 500 AOA
 *     - Anúncio = 500 AOA
 *   Sistema pronto para anúncios e links de partilha
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
   CONFIGURAÇÕES GLOBAIS
========================= */
const PORT = process.env.PORT || 4000;
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'ADMIN_SECRET_EXEMPLO';
const JWT_SECRET = process.env.JWT_SECRET || 'JWT_SECRET_EXEMPLO';
const MIN_WITHDRAW = Number(process.env.MIN_WITHDRAW || 600000);
const MAX_TASKS_PER_DAY = Number(process.env.MAX_TASKS_PER_DAY || 60);
const REWARD_SHARE = 500; // AOA
const REWARD_AD = 500;    // AOA
const SHARE_WINDOW_MS = 24 * 60 * 60 * 1000; // 24h
const AD_WINDOW_MS = 24 * 60 * 60 * 1000;    // 24h

/* =========================
   MIDDLEWARES
========================= */
app.use(helmet());
app.use(cors());
app.use(bodyParser.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'frontend')));

// Limitador global
app.use(rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 200,
    standardHeaders: true,
    legacyHeaders: false,
    message: { status: 429, erro: "Muitas requisições. Tente novamente mais tarde." }
}));

/* =========================
   BANCO DE DADOS
========================= */
const dbFile = path.join(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbFile, err => {
    if (err) console.error('❌ Erro ao abrir banco:', err.message);
    else console.log('📦 Banco SQLite carregado.');
});

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS usuarios (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        telefone TEXT UNIQUE NOT NULL,
        senha_hash TEXT NOT NULL,
        idade INTEGER NOT NULL,
        saldo INTEGER DEFAULT 0,
        criado_em DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS historico (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        usuario_id INTEGER NOT NULL,
        tipo TEXT NOT NULL,
        descricao TEXT,
        valor INTEGER NOT NULL,
        anuncio_id TEXT,
        criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(usuario_id) REFERENCES usuarios(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS saques (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        usuario_id INTEGER NOT NULL,
        valor INTEGER NOT NULL,
        numero_express TEXT NOT NULL,
        status TEXT DEFAULT 'pendente',
        criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
        pago_em DATETIME,
        FOREIGN KEY(usuario_id) REFERENCES usuarios(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS compartilhamentos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        usuario_id INTEGER NOT NULL,
        link_id TEXT NOT NULL,
        plataforma TEXT NOT NULL,
        valor INTEGER NOT NULL,
        criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(usuario_id) REFERENCES usuarios(id)
    )`);
});

/* =========================
   FUNÇÕES AUXILIARES
========================= */
const gerarToken = usuario => jwt.sign({ id: usuario.id, telefone: usuario.telefone }, JWT_SECRET, { expiresIn: '7d' });
const respostaErro = (res, codigo, mensagem) => res.status(codigo).json({ sucesso: false, erro: mensagem });

/* =========================
   MIDDLEWARES DE AUTENTICAÇÃO
========================= */
function autenticaJWT(req, res, next){
    const authHeader = req.headers['authorization'];
    if(!authHeader) return respostaErro(res,401,'Token ausente');
    const token = authHeader.split(' ')[1];
    if(!token) return respostaErro(res,401,'Token inválido');
    jwt.verify(token, JWT_SECRET, (err, decoded)=>{
        if(err) return respostaErro(res,403,'Token inválido ou expirado');
        req.usuario = decoded;
        next();
    });
}

function autenticaAdmin(req,res,next){
    if(req.headers['x-admin-secret']!==ADMIN_SECRET) return respostaErro(res,403,'Acesso administrativo negado');
    next();
}

/* =========================
   ROTAS FRONT-END
========================= */
app.get('/', (req,res)=>res.sendFile(path.join(__dirname,'frontend','login.html')));
app.get('/register',(req,res)=>res.sendFile(path.join(__dirname,'frontend','register.html')));

/* =========================
   ENDPOINTS PÚBLICOS
========================= */
app.post('/api/register', async (req,res)=>{
    try{
        const { telefone, senha, idade } = req.body;
        if(!telefone || !senha || !idade) return respostaErro(res,400,'Preencha todos os campos');
        if(String(telefone).length<9) return respostaErro(res,400,'Telefone inválido');
        if(idade<18) return respostaErro(res,400,'Apenas maiores de 18 anos');

        const senha_hash = await bcrypt.hash(senha,12);
        const stmt = db.prepare('INSERT INTO usuarios (telefone,senha_hash,idade) VALUES (?,?,?)');
        stmt.run(telefone,senha_hash,idade,function(err){
            if(err){
                if(err.message?.includes('UNIQUE')) return respostaErro(res,400,'Telefone já registado');
                return respostaErro(res,500,'Erro ao criar conta');
            }
            const usuario = { id:this.lastID, telefone };
            const token = gerarToken(usuario);
            res.json({ sucesso:true, mensagem:'Conta criada com sucesso!', usuario, token });
        });
        stmt.finalize();
    }catch(e){ console.error(e); respostaErro(res,500,'Erro interno'); }
});

app.post('/api/login',(req,res)=>{
    const { telefone, senha } = req.body;
    if(!telefone || !senha) return respostaErro(res,400,'Telefone e senha obrigatórios');

    db.get('SELECT * FROM usuarios WHERE telefone=?',[telefone], async (err,row)=>{
        if(err) return respostaErro(res,500,'Erro interno');
        if(!row) return respostaErro(res,401,'Credenciais inválidas');
        const valid = await bcrypt.compare(senha,row.senha_hash);
        if(!valid) return respostaErro(res,401,'Credenciais inválidas');
        const token = gerarToken(row);
        res.json({ sucesso:true, mensagem:'Login concluído', usuario:{id:row.id,telefone:row.telefone,saldo:row.saldo}, token });
    });
});

app.get('/api/saldo/:id', autenticaJWT, (req,res)=>{
    const id = Number(req.params.id);
    if(req.usuario.id!==id) return respostaErro(res,403,'Acesso não autorizado');
    db.get('SELECT saldo FROM usuarios WHERE id=?',[id],(err,row)=>{
        if(err) return respostaErro(res,500,'Erro interno');
        if(!row) return respostaErro(res,404,'Usuário não encontrado');
        res.json({ sucesso:true, saldo:row.saldo });
    });
});

/* =========================
   TAREFAS E ANÚNCIOS
========================= */
app.post('/api/tarefa', autenticaJWT, (req,res)=>{
    const usuario_id = req.usuario.id;
    const { tipo, descricao, valor, anuncio_id } = req.body;
    const intValor = Number(valor);
    if(!tipo || !descricao || isNaN(intValor) || !anuncio_id) return respostaErro(res,400,'Dados incompletos');

    const hoje = new Date().toISOString().split('T')[0];
    db.get(`SELECT COUNT(*) AS count FROM historico WHERE usuario_id=? AND tipo=? AND DATE(criado_em)=?`,
        [usuario_id,tipo,hoje],(err,row)=>{
        if(err) return respostaErro(res,500,'Erro interno');
        if(row.count>=MAX_TASKS_PER_DAY) return respostaErro(res,400,'Limite diário atingido');

        db.serialize(()=>{
            db.run('UPDATE usuarios SET saldo = saldo + ? WHERE id=?',[intValor,usuario_id]);
            db.run('INSERT INTO historico (usuario_id,tipo,descricao,valor,anuncio_id) VALUES (?,?,?,?,?)',
                [usuario_id,tipo,descricao,intValor,anuncio_id], err2=>{
                    if(err2) return respostaErro(res,500,'Erro ao registrar histórico');
                    db.get('SELECT saldo FROM usuarios WHERE id=?',[usuario_id],(err3,row3)=>{
                        if(err3) return respostaErro(res,500,'Erro interno');
                        res.json({ sucesso:true, mensagem:'Tarefa registrada', ganho:intValor, saldo_atual:row3.saldo });
                    });
                });
        });
    });
});

/* =========================
   COMPARTILHAMENTO SEGURO (500 AOA)
========================= */
app.post('/api/compartilhar', autenticaJWT, (req,res)=>{
    const usuario_id = req.usuario.id;
    const { link_id, plataforma } = req.body;
    if(!link_id || !plataforma) return respostaErro(res,400,'Dados incompletos');

    const limite = new Date(Date.now()-SHARE_WINDOW_MS).toISOString();
    db.get('SELECT COUNT(*) AS cnt FROM compartilhamentos WHERE usuario_id=? AND criado_em>?',[usuario_id,limite],(err,row)=>{
        if(err) return respostaErro(res,500,'Erro interno');
        if(row.cnt>0) return respostaErro(res,429,'Já recebeu recompensa por compartilhamento nas últimas 24h');

        db.serialize(()=>{
            db.run('UPDATE usuarios SET saldo = saldo + ? WHERE id=?',[REWARD_SHARE,usuario_id]);
            db.run('INSERT INTO compartilhamentos (usuario_id,link_id,plataforma,valor) VALUES (?,?,?,?)',
                [usuario_id,link_id,plataforma,REWARD_SHARE]);
            db.run('INSERT INTO historico (usuario_id,tipo,descricao,valor) VALUES (?,?,?,?)',
                [usuario_id,'compartilhamento',`Compartilhamento em ${plataforma}`,REWARD_SHARE]);
            db.get('SELECT saldo FROM usuarios WHERE id=?',[usuario_id],(err2,row2)=>{
                if(err2) return respostaErro(res,500,'Erro interno');
                res.json({ sucesso:true, mensagem:'Compartilhamento registrado', ganho:REWARD_SHARE, saldo_atual:row2.saldo });
            });
        });
    });
});

/* =========================
   HISTÓRICO
========================= */
app.get('/api/historico/:id', autenticaJWT, (req,res)=>{
    const id = Number(req.params.id);
    if(req.usuario.id!==id) return respostaErro(res,403,'Acesso negado');
    db.all('SELECT * FROM historico WHERE usuario_id=? ORDER BY criado_em DESC',[id],(err,rows)=>{
        if(err) return respostaErro(res,500,'Erro interno');
        res.json({ sucesso:true, historico:rows });
    });
});

/* =========================
   SAQUES
========================= */
app.post('/api/withdraw', autenticaJWT, (req,res)=>{
    const usuario_id = req.usuario.id;
    const { valor, numero_express } = req.body;
    const intValor = Number(valor);
    if(!intValor || !numero_express) return respostaErro(res,400,'Dados incompletos');
    if(intValor<MIN_WITHDRAW) return respostaErro(res,400,`Valor mínimo: ${MIN_WITHDRAW.toLocaleString()} AOA`);

    db.get('SELECT saldo FROM usuarios WHERE id=?',[usuario_id],(err,row)=>{
        if(err) return respostaErro(res,500,'Erro interno');
        if(!row) return respostaErro(res,404,'Usuário inexistente');
        if(row.saldo<intValor) return respostaErro(res,400,'Saldo insuficiente');

        db.serialize(()=>{
            db.run('INSERT INTO saques (usuario_id,valor,numero_express) VALUES (?,?,?)',[usuario_id,intValor,numero_express],function(err2){
                if(err2) return respostaErro(res,500,'Erro ao criar saque');
                const saqueId = this.lastID;
                db.run('UPDATE usuarios SET saldo=saldo-? WHERE id=?',[intValor,usuario_id]);
                db.run('INSERT INTO historico (usuario_id,tipo,descricao,valor) VALUES (?,?,?,?)',
                    [usuario_id,'saque',`Solicitação de saque #${saqueId}`,-intValor]);
                db.get('SELECT saldo FROM usuarios WHERE id=?',[usuario_id],(err3,row3)=>{
                    if(err3) return respostaErro(res,500,'Erro interno');
                    res.json({ sucesso:true, mensagem:'Pedido enviado! Aguarde aprovação.', saldo_atual:row3.saldo });
                });
            });
        });
    });
});

/* =========================
   ROTAS ADMINISTRADOR
========================= */
app.get('/api/admin/saques', autenticaAdmin, (req,res)=>{
    db.all(`SELECT s.*, u.telefone FROM saques s JOIN usuarios u ON u.id=s.usuario_id ORDER BY s.criado_em DESC`,[],(err,rows)=>{
        if(err) return respostaErro(res,500,'Erro interno');
        res.json({ sucesso:true, saques:rows });
    });
});

app.post('/api/admin/markPaid', autenticaAdmin, (req,res)=>{
    const { saque_id } = req.body;
    if(!saque_id) return respostaErro(res,400,'saque_id é obrigatório');
    db.run('UPDATE saques SET status="pago", pago_em=CURRENT_TIMESTAMP WHERE id=?',[saque_id],function(err){
        if(err) return respostaErro(res,500,'Erro ao atualizar');
        if(this.changes===0) return respostaErro(res,404,'Saque não encontrado');
        res.json({ sucesso:true, mensagem:'Saque marcado como pago' });
    });
});

app.get('/api/admin/usuarios', autenticaAdmin, (req,res)=>{
    db.all('SELECT id,telefone,idade,saldo,criado_em FROM usuarios ORDER BY criado_em DESC',[],(err,rows)=>{
        if(err) return respostaErro(res,500,'Erro interno');
        res.json({ sucesso:true, usuarios:rows });
    });
});

/* =========================
   INICIAR SERVIDOR
========================= */
app.listen(PORT,()=>console.log(`Servidor rodando na porta ${PORT}`));
