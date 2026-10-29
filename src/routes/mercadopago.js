// routes/mercadopago.js
// Integração OAuth com o Mercado Pago (cada loja conecta a própria conta).
//
// Variáveis de ambiente necessárias (Render):
//   MP_CLIENT_ID      -> número do app (7055673569481790)
//   MP_CLIENT_SECRET  -> Client Secret do app (credenciais de produção)
//   MP_REDIRECT_URI   -> https://api-99burger.onrender.com/integracoes/mercadopago/callback
//   FRONTEND_URL      -> (opcional) URL do dashboard; padrão abaixo

const crypto = require('crypto');
const axios = require('axios');
const db = require('../config/database');
const token = require('../token.js');

const MP_AUTH_URL = 'https://auth.mercadopago.com.br/authorization';
const MP_TOKEN_URL = 'https://api.mercadopago.com/oauth/token';
const FRONTEND_URL = (process.env.FRONTEND_URL || 'https://dashboard-retaguarda-99burger.vercel.app').replace(/\/$/, '');

const DIAS_ANTES_DE_RENOVAR = 30;            // renova quando faltar menos que isso pra vencer
const INTERVALO_RENOVACAO_MS = 12 * 60 * 60 * 1000; // confere a cada 12 horas
const EXPIRACAO_PADRAO_SEG = 15552000;       // 180 dias, caso o MP não informe

// --- helpers ---------------------------------------------------------------

function q(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.query(sql, params, (err, result) => (err ? reject(err) : resolve(result)));
    });
}

function configuracaoOk() {
    return !!(process.env.MP_CLIENT_ID && process.env.MP_CLIENT_SECRET && process.env.MP_REDIRECT_URI);
}

// Chama POST /oauth/token (serve para authorization_code e refresh_token)
async function pedirTokenAoMP(corpo) {
    const resp = await axios.post(
        MP_TOKEN_URL,
        {
            client_id: process.env.MP_CLIENT_ID,
            client_secret: process.env.MP_CLIENT_SECRET,
            ...corpo
        },
        {
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            timeout: 15000
        }
    );
    return resp.data;
}

// Salva os tokens da loja. novaConexao=true marca a data em que a loja conectou.
async function salvarTokens(id_estabelecimento, data, novaConexao) {
    const expiraEmSeg = Number(data.expires_in) || EXPIRACAO_PADRAO_SEG;

    await q(
        `UPDATE estabelecimento SET
            mp_access_token    = ?,
            mp_refresh_token   = ?,
            mp_token_expira_em = DATE_ADD(NOW(), INTERVAL ? SECOND),
            mp_user_id         = COALESCE(?, mp_user_id),
            mp_public_key      = COALESCE(?, mp_public_key),
            mp_conectado_em    = ${novaConexao ? 'NOW()' : 'mp_conectado_em'}
         WHERE id_estabelecimento = ?`,
        [
            data.access_token,
            data.refresh_token || null,
            expiraEmSeg,
            data.user_id != null ? String(data.user_id) : null,
            data.public_key || null,
            id_estabelecimento
        ]
    );
}

// --- renovação automática dos tokens ---------------------------------------

async function renovarTokens() {
    if (!configuracaoOk()) return;

    let lojas;
    try {
        lojas = await q(
            `SELECT id_estabelecimento, mp_refresh_token
               FROM estabelecimento
              WHERE mp_refresh_token IS NOT NULL
                AND mp_refresh_token <> ''
                AND mp_token_expira_em IS NOT NULL
                AND mp_token_expira_em < DATE_ADD(NOW(), INTERVAL ? DAY)`,
            [DIAS_ANTES_DE_RENOVAR]
        );
    } catch (err) {
        console.error('[MP] Erro ao buscar lojas para renovar token:', err.message);
        return;
    }

    for (const loja of lojas) {
        try {
            const data = await pedirTokenAoMP({
                grant_type: 'refresh_token',
                refresh_token: loja.mp_refresh_token
            });
            // O MP devolve um refresh_token novo a cada renovação: precisa gravar o novo.
            await salvarTokens(loja.id_estabelecimento, data, false);
            console.log(`[MP] Token renovado para a loja ${loja.id_estabelecimento}`);
        } catch (err) {
            console.error(
                `[MP] Falha ao renovar token da loja ${loja.id_estabelecimento}:`,
                err.response?.data || err.message
            );
        }
    }
}

// --- rotas -----------------------------------------------------------------

function registrarRotasMercadoPago(app) {

    // 1) Status da conexão (o dashboard usa pra mostrar "Conectado" / "Conectar")
    //    Nunca devolve o token, só informações de status.
    app.get('/integracoes/mercadopago/status', token.ValidateJWT, async (req, res) => {
        try {
            const id_estabelecimento = req.id_estabelecimento;
            if (!id_estabelecimento) {
                return res.status(400).json({ error: 'Estabelecimento não identificado no token.' });
            }

            const rows = await q(
                `SELECT
                    (mp_access_token IS NOT NULL AND mp_access_token <> '') AS conectado,
                    (mp_refresh_token IS NOT NULL AND mp_refresh_token <> '') AS via_oauth,
                    mp_conectado_em,
                    mp_token_expira_em,
                    mp_user_id
                   FROM estabelecimento
                  WHERE id_estabelecimento = ?`,
                [id_estabelecimento]
            );

            if (rows.length === 0) {
                return res.status(404).json({ error: 'Estabelecimento não encontrado.' });
            }

            const r = rows[0];
            return res.status(200).json({
                conectado: !!r.conectado,
                via_oauth: !!r.via_oauth,
                conectado_em: r.mp_conectado_em,
                expira_em: r.mp_token_expira_em,
                mp_user_id: r.mp_user_id
            });
        } catch (err) {
            console.error('[MP] Erro no status:', err.message);
            return res.status(500).json({ error: 'Erro ao consultar status da integração.' });
        }
    });

    // 2) Gera o link de autorização (o dashboard abre esse link para o lojista)
    app.get('/integracoes/mercadopago/conectar', token.ValidateJWT, async (req, res) => {
        try {
            if (!configuracaoOk()) {
                console.error('[MP] Faltam variáveis MP_CLIENT_ID / MP_CLIENT_SECRET / MP_REDIRECT_URI');
                return res.status(500).json({ error: 'Integração com o Mercado Pago não configurada no servidor.' });
            }

            const id_estabelecimento = req.id_estabelecimento;
            if (!id_estabelecimento) {
                return res.status(400).json({ error: 'Estabelecimento não identificado no token.' });
            }

            // limpa states vencidos e cria um novo (vale 15 minutos, uso único)
            await q('DELETE FROM mp_oauth_state WHERE expira_em < NOW()');

            const state = crypto.randomBytes(24).toString('hex'); // 48 caracteres
            await q(
                `INSERT INTO mp_oauth_state (state, id_estabelecimento, expira_em)
                 VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 15 MINUTE))`,
                [state, id_estabelecimento]
            );

            const url =
                `${MP_AUTH_URL}?client_id=${encodeURIComponent(process.env.MP_CLIENT_ID)}` +
                `&response_type=code&platform_id=mp` +
                `&state=${state}` +
                `&redirect_uri=${encodeURIComponent(process.env.MP_REDIRECT_URI)}`;

            return res.status(200).json({ url });
        } catch (err) {
            console.error('[MP] Erro ao gerar link de conexão:', err.message);
            return res.status(500).json({ error: 'Erro ao gerar link de conexão.' });
        }
    });

    // 3) Callback: o Mercado Pago devolve o navegador do lojista pra cá.
    //    É pública (o navegador chega sem JWT); quem identifica a loja é o "state".
    app.get('/integracoes/mercadopago/callback', async (req, res) => {
        const { code, state, error } = req.query;
        const voltar = (resultado) => res.redirect(`${FRONTEND_URL}/integracoes?mp=${resultado}`);

        if (error || !code || !state) return voltar('negado');

        try {
            const estadoStr = String(state);

            const rows = await q(
                'SELECT id_estabelecimento FROM mp_oauth_state WHERE state = ? AND expira_em > NOW()',
                [estadoStr]
            );
            // uso único: apaga o state logo de cara, tenha dado certo ou não
            await q('DELETE FROM mp_oauth_state WHERE state = ?', [estadoStr]);

            if (rows.length === 0) return voltar('expirado');
            const id_estabelecimento = rows[0].id_estabelecimento;

            const data = await pedirTokenAoMP({
                grant_type: 'authorization_code',
                code: String(code),
                redirect_uri: process.env.MP_REDIRECT_URI
            });

            if (!data.access_token) return voltar('erro');

            await salvarTokens(id_estabelecimento, data, true);
            console.log(`[MP] Loja ${id_estabelecimento} conectada ao Mercado Pago`);
            return voltar('ok');
        } catch (err) {
            console.error('[MP] Erro no callback OAuth:', err.response?.data || err.message);
            return voltar('erro');
        }
    });

    // 4) Desconectar (apaga os tokens da loja no nosso banco)
    app.delete('/integracoes/mercadopago', token.ValidateJWT, async (req, res) => {
        try {
            const id_estabelecimento = req.id_estabelecimento;
            if (!id_estabelecimento) {
                return res.status(400).json({ error: 'Estabelecimento não identificado no token.' });
            }

            await q(
                `UPDATE estabelecimento SET
                    mp_access_token    = NULL,
                    mp_refresh_token   = NULL,
                    mp_token_expira_em = NULL,
                    mp_user_id         = NULL,
                    mp_public_key      = NULL,
                    mp_conectado_em    = NULL
                 WHERE id_estabelecimento = ?`,
                [id_estabelecimento]
            );

            return res.status(200).json({ message: 'Mercado Pago desconectado.' });
        } catch (err) {
            console.error('[MP] Erro ao desconectar:', err.message);
            return res.status(500).json({ error: 'Erro ao desconectar.' });
        }
    });

    // Renovação automática: 1 minuto depois de subir e depois a cada 12 horas
    setTimeout(renovarTokens, 60 * 1000);
    setInterval(renovarTokens, INTERVALO_RENOVACAO_MS);
}

module.exports = registrarRotasMercadoPago;
module.exports.renovarTokens = renovarTokens;