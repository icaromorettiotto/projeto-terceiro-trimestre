import express from 'express';
import cors from 'cors';
import crypto from 'node:crypto';
import 'dotenv/config';

const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
const CHAT_MODEL = process.env.GROQ_MODEL || "openai/gpt-oss-120b";
const ATRASO_CADASTRO_MS = 5000; // atraso proposital do cadastro (coloque 0 para remover)

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

app.use((req, res, next) => {
    console.log(req.method, req.url);
    next();
});

// Em memória: some ao reiniciar o servidor.
const usuariosCadastrados = [];

const normalizarEmail = (email) => String(email).trim().toLowerCase();

function gerarHash(senha) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(senha, salt, 64).toString('hex');
    return `${salt}:${hash}`;
}

function conferirSenha(senha, armazenada) {
    const [salt, hash] = armazenada.split(':');
    const tentativa = crypto.scryptSync(senha, salt, 64);
    return crypto.timingSafeEqual(tentativa, Buffer.from(hash, 'hex'));
}

app.post('/cadastro', (req, res) => {
    const { usuario, email, senha } = req.body ?? {};

    if (!usuario || !email || !senha) {
        return res.status(400).json({ erro: "Todos os campos são obrigatórios" });
    }

    if (String(senha).length < 6) {
        return res.status(400).json({ erro: "Sua senha precisa ter no mínimo 6 dígitos" });
    }

    const emailNormalizado = normalizarEmail(email);

    if (usuariosCadastrados.some((u) => u.email === emailNormalizado)) {
        return res.status(409).json({ erro: "Este e-mail já foi cadastrado" });
    }

    console.log(`Dados recebidos de ${usuario}, processando...`);

    usuariosCadastrados.push({
        usuario,
        email: emailNormalizado,
        senhaHash: gerarHash(String(senha))
    });

    setTimeout(() => {
        console.log(`Usuário ${usuario} registrado com sucesso no e-mail ${emailNormalizado}`);

        res.json({
            mensagem: "Cadastro concluído!",
            perfil: `Conta de ${usuario} criada utilizando o e-mail ${emailNormalizado}`
        });
    }, ATRASO_CADASTRO_MS);
});

app.post('/login', (req, res) => {
    const { email, senha } = req.body ?? {};

    if (!email || !senha) {
        return res.status(400).json({ erro: "Informe todos os dados" });
    }

    const emailNormalizado = normalizarEmail(email);
    const conta = usuariosCadastrados.find((u) => u.email === emailNormalizado);

    if (!conta || !conferirSenha(String(senha), conta.senhaHash)) {
        return res.status(400).json({ erro: "E-mail ou senha inválidos!" });
    }

    return res.json({
        mensagem: "Acesso liberado!",
        usuario: conta.usuario // Retorna o nome do usuário cadastrado
    });
});

app.post('/chat', async (req, res) => {
    try {
        const API_KEY = process.env.GROQ_API_KEY;

        if (!API_KEY) {
            console.error("GROQ_API_KEY não encontrada. Verifique se o arquivo se chama .env (com ponto) e está na raiz do projeto.");
            return res.status(500).json({ erro: "Chave da API não configurada no servidor." });
        }

        const historico = Array.isArray(req.body?.historico) ? req.body.historico : [];

        const mensagens = [
            {
                role: "system",
                content: "Você é o J.A.R.V.I.S., a inteligência artificial do Homem de Ferro. Responda como o assistente do Tony Stark: sarcástico, tecnológico, inteligente e direto. Chame o usuário de Sr. Stark. Seja direto, engraçado e vá direto ao ponto."
            },
            ...historico.filter((m) => m && ["user", "assistant"].includes(m.role) && typeof m.content === "string")
        ];

        const respostaBruta = await fetch(GROQ_ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${API_KEY}`
            },
            body: JSON.stringify({ model: CHAT_MODEL, messages: mensagens }),
            signal: AbortSignal.timeout(30000)
        });

        const resultado = await respostaBruta.json();

        if (!respostaBruta.ok) {
            console.error(`Falha ao chamar a Groq (status ${respostaBruta.status}):`, resultado);
            const detalhe = resultado?.error?.message || "sem detalhes";
            return res.status(502).json({ erro: `Groq respondeu ${respostaBruta.status}: ${detalhe}` });
        }

        const texto = resultado?.choices?.[0]?.message?.content;
        if (!texto) {
            console.error("Resposta inesperada da Groq:", resultado);
            return res.status(502).json({ erro: "A Groq retornou uma resposta vazia." });
        }

        return res.json({ resposta: texto });

    } catch (erro) {
        console.error("Erro no /chat:", erro);
        return res.status(500).json({ erro: "Ocorreu um erro interno no servidor." });
    }
});

app.listen(PORT, (erro) => {
    if (erro) {
        console.error(`Não foi possível iniciar na porta ${PORT}:`, erro.message);
        process.exit(1);
    }
    console.log(`Servidor online na porta ${PORT}`);
});