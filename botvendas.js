const fs = require('fs');
const path = require('path');
const chalk = require('chalk').default;
const qrcode = require('qrcode-terminal');
const pino = require('pino');
const db = require('./db.js'); // Certifique-se de que db.js está no mesmo diretório
const moment = require('moment'); // Importado para validação de horários

const {
  default: makeWASocket,
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
  downloadContentFromMessage,
  delay
} = require('@whiskeysockets/baileys');

// Constantes
const TEMPO_EXPIRACAO_CHAT = 20 * 60 * 1000; // 20 minutos de inatividade para chat ativo
const TEMPO_EXPIRACAO_AVALIACAO = 5 * 60 * 1000; // 5 minutos para o cliente avaliar
const TEMPO_MEDIO_ATENDIMENTO_MINUTOS = 5; // Estimativa de 5 minutos por atendimento na fila

// OPÇÕES DE SETORES
const OPCOES_SETORES = ['1', '2', '3', '4']; // Opções de setores disponíveis

const COMANDO_ENCERRAR = 'encerrar'; // Comando exato para iniciar a confirmação
const COMANDO_SIM = 'sim'; // Comando para confirmar
const COMANDO_NAO = 'nao'; // Comando para cancelar (aceita 'não' e 'nao')
const COMANDO_MENU = 'menu';

const setores = {
  '1': { nome: 'Administrativo' },
  '2': { nome: 'Vendas' },
  '3': { nome: 'Suporte Técnico' },
  '4': { nome: 'Outros Assuntos' }
};

// Horários de funcionamento (usando formato de 24 horas)
const HORARIOS = {
    VENDAS_INICIO_H: 8,
    VENDAS_INICIO_M: 0,
    VENDAS_FIM_H: 17,
    VENDAS_FIM_M: 30,
    DIAS_UTEIS: [1, 2, 3, 4, 5] // 1 = Segunda-feira, 5 = Sexta-feira
};

// Garante que o diretório para mídias exista
const mediaDir = path.join(__dirname, 'public', 'media');
if (!fs.existsSync(mediaDir)) {
    fs.mkdirSync(mediaDir, { recursive: true });
    console.log(chalk.yellow(`Diretório para mídias criado: ${mediaDir}`));
}

async function startBot() {
  const authPath = './auth';
  if (!fs.existsSync(authPath)) fs.mkdirSync(authPath);

  // --- Inicialização do Banco de Dados ---
  await db.init(); // Inicializa as tabelas do banco de dados

  console.log(chalk.magenta('Aguardando cadastro de atendentes via painel web ou configuração manual.'));

  // --- Funções Auxiliares (adaptadas para usar o DB) ---

  /**
   * Envia uma mensagem para um JID e registra no DB.
   * @param {string} jid - O JID de destino.
   * @param {string} mensagem - O texto da mensagem.
   * @param {string} [tipoMidia=null] - Tipo da mídia (ex: 'image', 'video').
   * @param {string} [caminhoMidia=null] - Caminho local do arquivo de mídia.
   */
  async function enviarMensagem(jid, mensagem, tipoMidia = null, caminhoMidia = null) {
    try {
      if (tipoMidia && caminhoMidia) {
        // Envio de mídia
        const buffer = fs.readFileSync(path.join(__dirname, caminhoMidia));
        const opts = {};
        if (tipoMidia === 'image') opts.image = buffer;
        else if (tipoMidia === 'video') opts.video = buffer;
        else if (tipoMidia === 'audio') opts.audio = buffer;
        else if (tipoMidia === 'document') opts.document = buffer;
        else if (tipoMidia === 'sticker') opts.sticker = buffer;
        if (mensagem) {
            opts.caption = mensagem;
        }
        await sock.sendMessage(jid, opts);
      } else {
        // Envio de texto normal
        await sock.sendMessage(jid, { text: mensagem });
      }
      
      console.log(chalk.green(`✅ Mensagem enviada para ${jid}`));
      await db.registrarMensagem(jid, 'saida', mensagem, tipoMidia, caminhoMidia);
    } catch (err) {
      console.error(chalk.red(`❌ Erro enviando para ${jid}: ${err.message}`));
    }
  }

  /**
   * Envia o menu principal para um JID.
   * @param {string} jid - O JID do cliente.
   */
  async function enviarMenu(jid) {
    const textoMenu =
      `👋 Olá! Seja bem-vindo(a) à *Tracker CarSat*!\n` +
      `Estou aqui para ajudar você com nossos serviços de rastreamento veicular e segurança.\n\n` +
      `Por favor, escolha o setor desejado para que possamos te atender da melhor forma:\n\n` +
      `*1* - Administrativo 🏢\n` +
      `*2* - Vendas 💰 (das ${HORARIOS.VENDAS_INICIO_H}:00h às ${HORARIOS.VENDAS_FIM_H}:${HORARIOS.VENDAS_FIM_M}h)\n` +
      `*3* - Suporte Técnico 🛠️ (Atendimento 24h para furtos/roubos. Demais casos em horário comercial)\n` +
      `*4* - Outros Assuntos ❓\n\n` +
      `Digite o *número do setor* para continuar.`;

    await enviarMensagem(jid, textoMenu);
  }

  /**
   * Verifica se o horário atual está dentro do expediente para o setor de Vendas.
   * @returns {boolean} True se estiver dentro do expediente, false caso contrário.
   */
  function isHorarioComercialVendas() {
      const now = moment();
      const currentHour = now.hour();
      const currentMinute = now.minute();
      const currentDay = now.day();

      const isWeekday = HORARIOS.DIAS_UTEIS.includes(currentDay);

      if (!isWeekday) {
          return false;
      }

      const currentTimeInMinutes = currentHour * 60 + currentMinute;
      const startTimeInMinutes = HORARIOS.VENDAS_INICIO_H * 60 + HORARIOS.VENDAS_INICIO_M;
      const endTimeInMinutes = HORARIOS.VENDAS_FIM_H * 60 + HORARIOS.VENDAS_FIM_M;

      return currentTimeInMinutes >= startTimeInMinutes && currentTimeInMinutes <= endTimeInMinutes;
  }

  /**
   * Repassa uma mensagem (texto ou mídia) para um destino e registra.
   * Agora salva a mídia localmente.
   * @param {object} mensagemOriginal - O objeto da mensagem original do Baileys.
   * @param {string} destino - O JID de destino.
   * @param {string} direcao - 'cliente_para_atendente' ou 'atendente_para_cliente'.
   * @param {string} [nomeCliente=null] - Nome do cliente, se disponível.
   */
  async function repassarMensagem(mensagemOriginal, destino, direcao, nomeCliente = null) {
    try {
      const msg = mensagemOriginal.message ? mensagemOriginal.message : mensagemOriginal;
      const type = Object.keys(msg)[0];
      let loggedMessage = '';
      let savedMediaType = null;
      let savedMediaPath = null;

      if (['conversation', 'extendedTextMessage'].includes(type)) {
        const text = msg.conversation || msg.extendedTextMessage?.text;
        await sock.sendMessage(destino, { text });
        loggedMessage = text;
      } else {
        const mediaTypeBaileys = type.replace('Message', '');
        const stream = await downloadContentFromMessage(msg[type], mediaTypeBaileys);
        let buffer = Buffer.from([]);
        for await (const chunk of stream) {
          buffer = Buffer.concat([buffer, chunk]);
        }

        let extension = '';
        if (mediaTypeBaileys === 'image') extension = 'jpg';
        else if (mediaTypeBaileys === 'video') extension = 'mp4';
        else if (mediaTypeBaileys === 'audio') extension = 'ogg';
        else if (mediaTypeBaileys === 'document') {
          const mime = msg[type]?.mimetype;
          if (mime) {
            const mimeParts = mime.split('/');
            extension = mimeParts[1] || 'bin';
          } else {
            extension = 'bin';
          }
        }
        else if (mediaTypeBaileys === 'sticker') extension = 'webp';

        const fileName = `${Date.now()}_${mensagemOriginal.key.id}.${extension}`;
        const filePath = path.join(mediaDir, fileName);
        const publicPath = `/media/${fileName}`;

        fs.writeFileSync(filePath, buffer);
        console.log(chalk.blue(`📁 Mídia salva em: ${filePath}`));

        savedMediaType = mediaTypeBaileys;
        savedMediaPath = publicPath;

        const opts = {};
        if (mediaTypeBaileys === 'image') opts.image = buffer;
        else if (mediaTypeBaileys === 'video') opts.video = buffer;
        else if (mediaTypeBaileys === 'audio') opts.audio = buffer;
        else if (mediaTypeBaileys === 'document') opts.document = buffer;
        else if (mediaTypeBaileys === 'sticker') opts.sticker = buffer;
        
        if (msg[type]?.caption) {
          opts.caption = msg[type].caption;
          loggedMessage = opts.caption;
        } else {
          loggedMessage = `[MÍDIA: ${mediaTypeBaileys.toUpperCase()}]`;
        }
        await sock.sendMessage(destino, opts);
      }

      console.log(chalk.green(`➡️ Mensagem repassada para ${destino} (${direcao}).`));
      await db.registrarMensagem(
        mensagemOriginal.key.remoteJid,
        direcao === 'cliente_para_atendente' ? 'entrada' : 'saida',
        loggedMessage,
        savedMediaType,
        savedMediaPath,
        nomeCliente // Adiciona o nome do cliente ao registro no DB
      );

    } catch (err) {
      console.error(chalk.red(`❌ Erro ao repassar mensagem: ${err.message}`));
    }
  }

  /**
   * Tenta conectar o próximo cliente da fila a um atendente disponível no setor.
   * @param {string} setor - O setor para tentar conectar.
   * @returns {boolean} True se um cliente foi conectado, false caso contrário.
   */
  async function conectarProximoDaFila(setor) {
    const fila = await db.buscarFila(setor);
    const atendente = await db.getAtendenteDisponivel(setor);

    if (fila.length === 0 || !atendente) {
      return false;
    }

    const clienteJid = fila[0];

    const clienteEstado = await db.buscarAtendido(clienteJid);
    if (!clienteEstado || (clienteEstado.etapa !== 2 && clienteEstado.etapa !== 4)) {
        console.log(chalk.yellow(`Cliente ${clienteJid} não está em estado conectável (${clienteEstado?.etapa}). Removendo da fila.`));
        await db.removerFila(clienteJid);
        await db.registrarEvento('cliente_removido_fila_estado_invalido', clienteJid, setor, `Removido da fila. Etapa atual: ${clienteEstado?.etapa}.`);
        return conectarProximoDaFila(setor);
    }

    // Tenta obter o nome do cliente do perfil do WhatsApp
    let nomeCliente = null;
    try {
      const profile = await sock.profilePictureUrl(clienteJid, 'image');
      const contact = await sock.getContactProfile(clienteJid);
      nomeCliente = contact?.pushName || msg?.pushName || clienteJid.replace('@s.whatsapp.net', '');
    } catch (err) {
      console.log(chalk.yellow(`Não foi possível obter o nome do cliente ${clienteJid}: ${err.message}`));
      nomeCliente = clienteJid.replace('@s.whatsapp.net', '');
    }

    await db.removerFila(clienteJid);
    await db.registrarEvento('cliente_saiu_fila', clienteJid, setor, `Saiu da fila para iniciar atendimento.`);

    const atendimento = {
      jid: clienteJid,
      etapa: 2,
      ultimaInteracao: Date.now(),
      setor,
      atendente: atendente.jid,
      avaliacaoPendente: false,
      confirmacaoPendente: null,
      nomeCliente
    };

    await db.salvarAtendido(atendimento);
    await db.setAtendente(atendente.jid, atendente.nome, setor, true); // Corrected line

    // Registrar o início do atendimento e obter o código
    const { codigo } = await db.registrarInicioAtendimento(clienteJid, setor, atendente.jid);
    await db.registrarEvento('atendimento_iniciado', clienteJid, setor, `Atendente: ${atendente.jid}, Cliente: ${nomeCliente}, Código: ${codigo}`);

    await enviarMensagem(clienteJid,
      `✨ *Atendimento iniciado na Tracker CarSat!* ✨\n` +
      `*Código do Atendimento:* ${codigo}\n` +
      `Você agora está sendo atendido(a) no setor *${setores[setor].nome}* pelo atendente *${atendente.nome}*.\n` +
      `Por favor, aguarde a resposta do nosso especialista. Para finalizar o atendimento a qualquer momento, digite *${COMANDO_ENCERRAR}* (mas avise o atendente!).`);

    await enviarMensagem(atendente.jid,
      `📞 *NOVO ATENDIMENTO - Tracker CarSat* 📞\n` +
      `*Código do Atendimento:* ${codigo}\n` +
      `*Cliente:* ${nomeCliente} (${clienteJid.replace('@s.whatsapp.net', '')})\n` +
      `*Setor:* ${setores[setor].nome}\n\n` +
      `Pode iniciar o atendimento normalmente. Para finalizar esta conversa, digite *${COMANDO_ENCERRAR}*.`);

    console.log(chalk.blue(`➡️ Atendimento iniciado para cliente ${nomeCliente} (${clienteJid}) no setor ${setores[setor].nome} com atendente ${atendente.jid}, Código: ${codigo}`));
    return true;
  }

  /**
   * Finaliza um atendimento, seja por comando manual ou inatividade.
   * @param {string} clienteJid - O JID do cliente.
   * @param {boolean} motivoManual - true se finalizado por comando, false se por inatividade/avaliação.
   */
  async function finalizarAtendimento(clienteJid, motivoManual = false) {
    const info = await db.buscarAtendido(clienteJid);
    if (!info) {
      console.log(chalk.yellow(`Atendimento não encontrado para ${clienteJid} ao tentar finalizar.`));
      return;
    }

    const { setor, atendente } = info;
    const codigoAtendimento = await db.buscarCodigoAtendimento(clienteJid, setor);

    await db.registrarFimAtendimento(clienteJid);
    await db.registrarEvento('atendimento_encerrado', clienteJid, setor, `Motivo: ${motivoManual ? 'manual' : 'inatividade/avaliação expirada'}, Código: ${codigoAtendimento}`);

    if (!motivoManual) {
      await enviarMensagem(clienteJid,
        `😴 Seu atendimento na *Tracker CarSat* (Código: ${codigoAtendimento}) foi encerrado por inatividade ou por falta de avaliação.\n` +
        `Se precisar de ajuda novamente, basta enviar uma nova mensagem!`
      );
      info.etapa = 0;
      info.avaliacaoPendente = false;
      info.confirmacaoPendente = null;
      info.ultimaInteracao = Date.now();
      await db.salvarAtendido(info);
    } else {
      await enviarMensagem(clienteJid,
        `✅ *Atendimento Finalizado!* ✅\n\n` +
        `*Código do Atendimento:* ${codigoAtendimento}\n` +
        `Agradecemos por entrar em contato com a *Tracker CarSat*! \n` +
        `Esperamos ter ajudado você da melhor forma. 😊\n\n` +
        `✨ *Sua Opinião Vale Ouro!* ✨\n` +
        `Para nos ajudar a aprimorar nossos serviços, por favor, avalie seu atendimento ` +
        `com uma nota de *1 a 5 estrelas*.\n\n` +
        `🌟 *5 Estrelas*: Excelente\n` +
        `⭐ *4 Estrelas*: Muito Bom\n` +
        `✨ *3 Estrelas*: Bom\n` +
        `⚡ *2 Estrelas*: Regular\n` +
        `💔 *1 Estrela*: Muito Ruim\n\n` +
        `Basta digitar o número correspondente à sua experiência.\n` +
        `Sua colaboração é essencial para continuarmos melhorando! 🙏`);
      
      info.avaliacaoPendente = true;
      info.etapa = 3;
      info.ultimaInteracao = Date.now();
      info.confirmacaoPendente = null;
      await db.salvarAtendido(info);
    }

    if (atendente) {
      const atendenteDados = await db.buscarAtendente(atendente);
      if (atendenteDados) {
        await db.setAtendente(atendente, atendenteDados.nome, setor, false);
        await enviarMensagem(atendente, 
          `🛑 Atendimento encerrado para o cliente ${info.nomeCliente || clienteJid.replace('@s.whatsapp.net', '')} (Código: ${codigoAtendimento}) no setor *${setores[setor].nome}*.`);
      } else {
        await db.setAtendente(atendente, 'Atendente Desconhecido', setor, false);
      }
      await conectarProximoDaFila(setor);
    } else {
      await conectarProximoDaFila(setor);
    }

    console.log(chalk.yellow(`🛑 Atendimento encerrado (${motivoManual ? 'manual' : 'inatividade/avaliação'}) - Cliente: ${clienteJid}, Código: ${codigoAtendimento}`));
  }

  // --- Inicialização do Baileys ---
  const { state, saveCreds } = await useMultiFileAuthState(authPath);
  const { version } = await fetchLatestBaileysVersion();
  const logger = pino({ level: 'silent' });

  const sock = makeWASocket({
    version,
    auth: state,
    logger,
    printQRInTerminal: true
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async update => {
    const { connection, qr, lastDisconnect } = update;
    if (qr && !fs.existsSync(path.join(authPath, 'creds.json'))) {
      console.log(chalk.cyan('📲 Escaneie o QR Code para conectar a Tracker CarSat:'));
      qrcode.generate(qr, { small: true });
    }
    if (connection === 'open') {
      console.log(chalk.green('✅ Bot Tracker CarSat conectado!'));
    } else if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      const deveReconectar = code !== DisconnectReason.loggedOut;
      console.log(chalk.red(`⚠️ Conexão encerrada. Reconectar em 5s? ${deveReconectar ? 'Sim' : 'Não'}`));
      if (deveReconectar) {
        setTimeout(startBot, 5000);
      } else {
        console.log(chalk.red('⚠️ Logout detectado. Encerrando o bot Tracker CarSat.'));
        process.exit(0);
      }
    }
  });

  // --- Limpeza de Inatividade e Avaliação E AUTO-ALOCAÇÃO PERIÓDICA ---
  setInterval(async () => {
    const agora = Date.now();
    try {
      const atendimentosAtivos = await new Promise((resolve, reject) => {
        db.db.all(`SELECT * FROM atendidos WHERE etapa = 2 OR etapa = 3 OR etapa = 4`, (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        });
      });

      for (const info of atendimentosAtivos) {
        if (info.etapa === 3) {
          if (agora - info.ultimaInteracao > TEMPO_EXPIRACAO_AVALIACAO) {
            console.log(chalk.yellow(`Inatividade na avaliação detectada para ${info.jid}. Encerrando avaliação.`));
            await db.registrarEvento('avaliacao_expirada', info.jid, info.setor, `Avaliação encerrada por inatividade.`);
            
            info.etapa = 0;
            info.avaliacaoPendente = false;
            info.confirmacaoPendente = null;
            info.ultimaInteracao = Date.now();
            await db.salvarAtendido(info);

            const codigoAtendimento = await db.buscarCodigoAtendimento(info.jid, info.setor);
            await enviarMensagem(info.jid, 
              `⏰ Tempo de avaliação esgotado para o atendimento (Código: ${codigoAtendimento}).\n` +
              `Se precisar de ajuda novamente, por favor, envie uma nova mensagem.`);
          }
        } else if (info.etapa === 2 || info.etapa === 4) {
          if (agora - info.ultimaInteracao > TEMPO_EXPIRACAO_CHAT) {
            console.log(chalk.yellow(`Inatividade no chat detectada para ${info.jid}. Encerrando atendimento.`));
            await db.registrarEvento('inatividade_detectada', info.jid, info.setor, `Atendimento encerrado por inatividade na etapa ${info.etapa}.`);
            await finalizarAtendimento(info.jid, false);
          }
        }
      }

      for (const setorId in setores) {
        const connected = await conectarProximoDaFila(setorId);
        if (connected) {
          console.log(chalk.blue(`Conectado cliente do setor ${setores[setorId].nome} via loop de automação.`));
          await delay(100);
          await conectarProximoDaFila(setorId);
        }
      }

    } catch (err) {
      console.error(chalk.red(`Erro no loop de automação: ${err.message}`));
    }
  }, 5000);

  // --- Manipulação de Mensagens Recebidas ---
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    const msg = messages[0];
    if (!msg.message || msg.key.fromMe) return;

    const from = msg.key.remoteJid;
    if (!from.endsWith('@s.whatsapp.net')) return;

    const texto = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
    const textoTrim = texto.trim().toLowerCase();

    const messageType = Object.keys(msg.message)[0];
    let nomeCliente = msg.pushName || from.replace('@s.whatsapp.net', '');
    if (messageType === 'conversation' || messageType === 'extendedTextMessage') {
      await db.registrarMensagem(from, 'entrada', texto, null, null, nomeCliente);
    }

    const atendenteInfo = await db.buscarAtendente(from);
    const ehAtendente = atendenteInfo !== null;

    // --- Lógica para ATENDENTES ---
    if (ehAtendente) {
      const clienteJid = await db.buscarClientePorAtendente(from);
      if (clienteJid) {
        let atendimentoCliente = await db.buscarAtendido(clienteJid);

        // Se o atendimento do cliente está aguardando confirmação do atendente
        if (atendimentoCliente && atendimentoCliente.etapa === 4 && atendimentoCliente.confirmacaoPendente === 'encerrar_atendente') {
          if (textoTrim === COMANDO_SIM) {
            const codigoAtendimento = await db.buscarCodigoAtendimento(clienteJid, atendimentoCliente.setor);
            await enviarMensagem(from, 
              `✅ Confirmação recebida! Finalizando atendimento para ${atendimentoCliente.nomeCliente || clienteJid.replace('@s.whatsapp.net', '')} (Código: ${codigoAtendimento}).`);
            await finalizarAtendimento(clienteJid, true);
          } else if (textoTrim === COMANDO_NAO) {
            atendimentoCliente.etapa = 2;
            atendimentoCliente.confirmacaoPendente = null;
            await db.salvarAtendido(atendimentoCliente);
            const codigoAtendimento = await db.buscarCodigoAtendimento(clienteJid, atendimentoCliente.setor);
            await enviarMensagem(from, 
              `❌ Comando de encerrar cancelado para ${atendimentoCliente.nomeCliente || clienteJid.replace('@s.whatsapp.net', '')} (Código: ${codigoAtendimento}). O atendimento continua.`);
            await enviarMensagem(clienteJid, 
              `Seu atendente cancelou o pedido de encerramento do atendimento (Código: ${codigoAtendimento}). O atendimento continua normalmente.`);
          } else {
            await enviarMensagem(from, 
              `Por favor, digite *${COMANDO_SIM}* para confirmar o encerramento do atendimento para ${atendimentoCliente.nomeCliente || clienteJid.replace('@s.whatsapp.net', '')} ou *${COMANDO_NAO}* para cancelar.`);
          }
          return;
        }

        // Se o atendente digitou o comando de encerrar EXATO
        if (textoTrim === COMANDO_ENCERRAR) {
          if (atendimentoCliente) {
            atendimentoCliente.etapa = 4;
            atendimentoCliente.confirmacaoPendente = 'encerrar_atendente';
            await db.salvarAtendido(atendimentoCliente);
            const codigoAtendimento = await db.buscarCodigoAtendimento(clienteJid, atendimentoCliente.setor);
            await enviarMensagem(from, 
              `Você pediu para encerrar o atendimento do cliente ${atendimentoCliente.nomeCliente || clienteJid.replace('@s.whatsapp.net', '')} (Código: ${codigoAtendimento}). Tem certeza?\nDigite *${COMANDO_SIM}* para confirmar ou *${COMANDO_NAO}* para cancelar.`);
            await enviarMensagem(clienteJid, 
              `Seu atendente iniciou o processo de encerramento do atendimento (Código: ${codigoAtendimento}). Por favor, aguarde a confirmação.`);
            await db.registrarEvento('confirmacao_encerrar_atendente', clienteJid, atendimentoCliente.setor, `Atendente ${from} iniciou pedido de encerramento. Código: ${codigoAtendimento}`);
          } else {
            await enviarMensagem(from, "Nenhum atendimento ativo no momento para encerrar.");
          }
          return;
        }

        // Comando: /transferir <número_do_setor>
        if (textoTrim.startsWith('/transferir')) {
          const partes = textoTrim.split(' ');
          const novoSetor = partes[1];

          if (!OPCOES_SETORES.includes(novoSetor)) {
            await enviarMensagem(from,
              `❌ Setor inválido. Digite: /transferir <número_do_setor>\n` +
              `Setores disponíveis:\n` +
              OPCOES_SETORES.map(s => `*${s}* - ${setores[s].nome}`).join('\n') +
              `\nExemplo: /transferir 1`
            );
            return;
          }

          if (!atendimentoCliente) {
            await enviarMensagem(from, `❌ Nenhum cliente está em atendimento com você agora.`);
            return;
          }

          if (novoSetor === atendimentoCliente.setor) {
            await enviarMensagem(from, `⚠️ O cliente já está no setor *${setores[novoSetor].nome}*.`);
            return;
          }

          // VALIDAÇÃO DE HORÁRIO PARA O SETOR DE VENDAS (OPÇÃO 2)
          if (novoSetor === '2' && !isHorarioComercialVendas()) {
            await enviarMensagem(from,
              `⏰ O setor de Vendas está fora do horário de atendimento (Segunda a Sexta, das ${HORARIOS.VENDAS_INICIO_H}:00h às ${HORARIOS.VENDAS_FIM_H}:${HORARIOS.VENDAS_FIM_M}h).\n` +
              `Por favor, escolha outro setor ou tente novamente durante o horário comercial.`
            );
            return;
          }

          // Buscar o código de atendimento atual
          const codigoAtual = await db.buscarCodigoAtendimento(clienteJid, atendimentoCliente.setor);

          // Finalizar o atendimento atual
          await db.registrarFimAtendimento(clienteJid);

          // Libera o atendente atual
          await db.setAtendente(from, atendenteInfo.nome, atendenteInfo.setor, false);

          // Atualiza o atendimento do cliente
          atendimentoCliente.setor = novoSetor;
          atendimentoCliente.atendente = null;
          atendimentoCliente.etapa = 2;
          atendimentoCliente.ultimaInteracao = Date.now();
          await db.salvarAtendido(atendimentoCliente);

          // Adiciona o cliente à fila do novo setor
          await db.adicionarFila(clienteJid, novoSetor);
          await db.registrarEvento('cliente_transferido', clienteJid, novoSetor, `Transferido por ${from} do setor ${setores[atendimentoCliente.setor].nome}, Código anterior: ${codigoAtual}`);

          // Notifica o atendente e o cliente
          await enviarMensagem(from, 
            `✅ Cliente ${atendimentoCliente.nomeCliente || clienteJid.replace('@s.whatsapp.net', '')} transferido do setor *${setores[atendimentoCliente.setor].nome}* (Código: ${codigoAtual}) para o setor *${setores[novoSetor].nome}*.`);
          await enviarMensagem(clienteJid,
            `🔄 Seu atendimento foi transferido do setor *${setores[atendimentoCliente.setor].nome}* (Código: ${codigoAtual}) para o setor *${setores[novoSetor].nome}*.\n` +
            `Aguarde, você será atendido em breve pela *Tracker CarSat*.`
          );

          // Tenta conectar o cliente ao novo setor
          const connected = await conectarProximoDaFila(novoSetor);
          if (!connected) {
            const filaPosicao = (await db.buscarFila(novoSetor)).indexOf(clienteJid) + 1;
            const estimativaTempo = filaPosicao * TEMPO_MEDIO_ATENDIMENTO_MINUTOS;
            await enviarMensagem(clienteJid,
              `⏳ No momento, todos os atendentes do setor *${setores[novoSetor].nome}* estão ocupados.\n` +
              `Você está na posição *${filaPosicao}* da fila. ` +
              `A estimativa de espera é de *aproximadamente ${estimativaTempo} minutos*.`
            );
          }

          return;
        }

        // Se a mensagem do atendente tem texto OU é uma mídia, encaminha e registra
        if (messageType !== 'protocolMessage' && messageType !== 'stickerSyncResponse') {
          await repassarMensagem(msg, clienteJid, 'atendente_para_cliente', atendimentoCliente.nomeCliente);
        }
        
      } else {
        await enviarMensagem(from, "Nenhum atendimento ativo no momento. Quando um cliente for direcionado a você, as mensagens aparecerão aqui.");
      }
      return;
    }

    // --- Lógica para CLIENTES ---
    let estado = await db.buscarAtendido(from);

    if (!estado || estado.etapa === null || estado.etapa === undefined || estado.etapa === 0) {
      if (OPCOES_SETORES.includes(textoTrim)) {
        const setor = textoTrim;

        if (setor === '2' && !isHorarioComercialVendas()) {
          await enviarMensagem(from,
            `⏰ Olá! Nosso setor de Vendas da *Tracker CarSat* funciona de Segunda a Sexta, das ${HORARIOS.VENDAS_INICIO_H}:00h às ${HORARIOS.VENDAS_FIM_H}:${HORARIOS.VENDAS_FIM_M}h.\n` +
            `No momento, estamos fora do horário de atendimento. Por favor, retorne durante nosso expediente ou escolha outra opção do menu.`
          );
          await enviarMenu(from);
          return;
        }

        estado = {
          jid: from,
          etapa: 2,
          setor,
          ultimaInteracao: Date.now(),
          atendente: null,
          avaliacaoPendente: false,
          confirmacaoPendente: null,
          nomeCliente
        };
        await db.salvarAtendido(estado);

        const filaAtual = await db.buscarFila(setor);
        if (!filaAtual.includes(from)) {
          await db.adicionarFila(from, setor);
          await db.registrarEvento('cliente_entrou_fila', from, setor, `Cliente ${nomeCliente} escolheu setor ${setores[setor].nome}.`);
        }

        const connected = await conectarProximoDaFila(setor);
        if (!connected) {
          const filaPosicao = (await db.buscarFila(setor)).indexOf(from) + 1;
          const estimativaTempo = filaPosicao * TEMPO_MEDIO_ATENDIMENTO_MINUTOS;

          await enviarMensagem(from,
            `⏳ No momento, todos os nossos atendentes do setor *${setores[setor].nome}* estão ocupados.\n` +
            `Você está na posição *${filaPosicao}* da fila. ` +
            `Aguarde um instante, a estimativa de tempo de espera é de *aproximadamente ${estimativaTempo} minutos*.\n\n` +
            `Pode fechar o WhatsApp se desejar. Nós te avisaremos quando for a sua vez de ser atendido(a) pela *Tracker CarSat*!`
          );
        }
        return;
      } else {
        estado = { jid: from, etapa: 0, ultimaInteracao: Date.now(), setor: null, atendente: null, avaliacaoPendente: false, confirmacaoPendente: null, nomeCliente };
        await db.salvarAtendido(estado);
        await enviarMenu(from);
        return;
      }
    }

    if (estado.etapa !== 3 && estado.etapa !== 4) {
      estado.ultimaInteracao = Date.now();
      await db.salvarAtendido(estado);
    }

    // --- Máquina de Estados para Clientes ---
    switch (estado.etapa) {
      case 2:
        if (textoTrim === COMANDO_ENCERRAR) {
          await enviarMensagem(from, `Para encerrar o atendimento, por favor, *solicite ao atendente* que finalize a conversa. Ele fará o processo por você.`);
          await db.registrarEvento('cliente_tentou_encerrar', from, estado.setor, `Cliente ${nomeCliente} tentou usar comando encerrar em atendimento ativo.`);
          return;
        }

        if (textoTrim === COMANDO_MENU) {
          await enviarMensagem(from,
            `Você está em um atendimento ativo no setor *${setores[estado.setor].nome}*.\n` +
            `Para finalizar esta conversa, por favor, *solicite ao atendente* que finalize o atendimento.\n` +
            `Caso contrário, continue enviando suas mensagens para o atendente.`
          );
          return;
        }

        const atendimentoAtual = await db.buscarAtendido(from);
        const estaNaFila = (await db.buscarFila(estado.setor)).includes(from);

        if (estaNaFila && (!atendimentoAtual || !atendimentoAtual.atendente)) {
          const filaPosicao = (await db.buscarFila(estado.setor)).indexOf(from) + 1;
          const estimativaTempo = filaPosicao * TEMPO_MEDIO_ATENDIMENTO_MINUTOS;

          await enviarMensagem(from,
            `Você já está na fila para o setor *${setores[estado.setor].nome}* na posição *${filaPosicao}*.\n` +
            `Aguarde um instante, a estimativa de tempo de espera é de *aproximadamente ${estimativaTempo} minutos*.\n\n` +
            `Pode fechar o WhatsApp se desejar. Nós te avisaremos quando for a sua vez de ser atendido(a) pela *Tracker CarSat*!`
          );
          return;
        }

        if (atendimentoAtual && atendimentoAtual.atendente) {
          await repassarMensagem(msg, atendimentoAtual.atendente, 'cliente_para_atendente', nomeCliente);
        }
        return;

      case 3:
        const nota = parseInt(textoTrim);
        if (estado && estado.avaliacaoPendente) {
          if (nota >= 1 && nota <= 5) {
            await db.salvarAvaliacao(estado.jid, estado.atendente, estado.setor, nota, '');

            estado.avaliacaoPendente = false;
            estado.etapa = 0;
            estado.confirmacaoPendente = null;
            estado.ultimaInteracao = Date.now();
            await db.salvarAtendido(estado);

            const codigoAtendimento = await db.buscarCodigoAtendimento(estado.jid, estado.setor);
            console.log(chalk.blue(`Cliente ${nomeCliente} (${from}) avaliou com ${nota} estrelas para o setor ${estado.setor}, Código: ${codigoAtendimento}.`));
            await db.registrarEvento('avaliacao_recebida', from, estado.setor, `Nota: ${nota}, Cliente: ${nomeCliente}, Código: ${codigoAtendimento}.`);

            await enviarMensagem(from, 
              `🙏 Obrigado(a) pela sua avaliação de ${nota} estrelas na *Tracker CarSat*! Sua opinião nos ajuda a melhorar.`);
            await enviarMenu(from);
          } else {
            if (textoTrim === COMANDO_MENU) {
              estado.avaliacaoPendente = false;
              estado.etapa = 0;
              estado.confirmacaoPendente = null;
              estado.ultimaInteracao = Date.now();
              await db.salvarAtendido(estado);
              await enviarMensagem(from, 'Sua avaliação foi cancelada.');
              await enviarMenu(from);
              return;
            }
            await enviarMensagem(from, '⚠️ Por favor, envie uma nota válida de 1 a 5 estrelas.');
          }
        } else {
          estado.etapa = 0;
          estado.confirmacaoPendente = null;
          estado.ultimaInteracao = Date.now();
          await db.salvarAtendido(estado);
          await enviarMensagem(from, '✅ Parece que você já avaliou este atendimento ou não há avaliação pendente no momento.');
          await enviarMenu(from);
        }
        return;

      case 4:
        let atendimentoAguardandoConfirmacao = await db.buscarAtendido(from);

        if (!atendimentoAguardandoConfirmacao || !atendimentoAguardandoConfirmacao.confirmacaoPendente) {
          console.warn(chalk.yellow(`Estado 4 inconsistente para ${from}. Redefinindo.`));
          await db.salvarAtendido({ jid: from, etapa: 0, ultimaInteracao: Date.now(), setor: null, atendente: null, avaliacaoPendente: false, confirmacaoPendente: null, nomeCliente });
          await enviarMensagem(from, 
            '⚠️ Houve um problema com o seu atendimento e precisamos reiniciar.\n' + 
            `Por favor, digite *${COMANDO_MENU}* para começar novamente com a *Tracker CarSat*.`);
          return;
        }

        if (ehAtendente && atendimentoAguardandoConfirmacao.confirmacaoPendente === 'encerrar_atendente') {
          if (textoTrim === COMANDO_SIM) {
            const clientJidFromAttendant = await db.buscarClientePorAtendente(from);
            if (clientJidFromAttendant) {
              const codigoAtendimento = await db.buscarCodigoAtendimento(clientJidFromAttendant, atendimentoAguardandoConfirmacao.setor);
              await enviarMensagem(from, 
                `✅ Confirmação recebida! Finalizando atendimento para ${atendimentoAguardandoConfirmacao.nomeCliente || clientJidFromAttendant.replace('@s.whatsapp.net', '')} (Código: ${codigoAtendimento}).`);
              await finalizarAtendimento(clientJidFromAttendant, true);
            } else {
              await enviarMensagem(from, `Não foi possível encontrar um atendimento ativo para confirmar o encerramento.`);
            }
          } else if (textoTrim === COMANDO_NAO) {
            const clientJidFromAttendant = await db.buscarClientePorAtendente(from);
            if (clientJidFromAttendant) {
              let clientStateToRevert = await db.buscarAtendido(clientJidFromAttendant);
              if (clientStateToRevert) {
                clientStateToRevert.etapa = 2;
                clientStateToRevert.confirmacaoPendente = null;
                await db.salvarAtendido(clientStateToRevert);
                const codigoAtendimento = await db.buscarCodigoAtendimento(clientJidFromAttendant, clientStateToRevert.setor);
                await enviarMensagem(clientJidFromAttendant, 
                  `Seu atendente cancelou o pedido de encerramento do atendimento (Código: ${codigoAtendimento}). O atendimento continua normalmente.`);
              }
            }
            atendimentoAguardandoConfirmacao.etapa = 2;
            atendimentoAguardandoConfirmacao.confirmacaoPendente = null;
            await db.salvarAtendido(atendimentoAguardandoConfirmacao);
            const codigoAtendimento = await db.buscarCodigoAtendimento(clientJidFromAttendant, atendimentoAguardandoConfirmacao.setor);
            await enviarMensagem(from, 
              `❌ Comando de encerrar cancelado para o atendimento (Código: ${codigoAtendimento}). O atendimento continua.`);
          } else {
            await enviarMensagem(from, 
              `Por favor, digite *${COMANDO_SIM}* para confirmar o encerramento ou *${COMANDO_NAO}* para cancelar.`);
          }
        } else {
          const codigoAtendimento = await db.buscarCodigoAtendimento(from, atendimentoAguardandoConfirmacao.setor);
          await enviarMensagem(from, 
            `Você está aguardando uma confirmação do atendente para o atendimento (Código: ${codigoAtendimento}). Por favor, aguarde.`);
        }
        return;

      default:
        console.warn(chalk.yellow(`Estado desconhecido para ${from} (${estado.etapa}). Redefinindo conversa.`));
        await db.salvarAtendido({ jid: from, etapa: 0, ultimaInteracao: Date.now(), setor: null, atendente: null, avaliacaoPendente: false, confirmacaoPendente: null, nomeCliente });
        await enviarMensagem(from,
          '⚠️ Houve um problema com o seu atendimento e precisamos reiniciar.\n' +
          `Por favor, digite *${COMANDO_MENU}* para começar novamente com a *Tracker CarSat*.`);
        break;
    }
  });

  sock.ev.on('presence.update', update => {});
}

startBot();