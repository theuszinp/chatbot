const express = require('express');
const path = require('path');
const db = require('./db.js');
const moment = require('moment');
const { Server } = require('socket.io');
const http = require('http');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

// Promisify db.all for async/await
db.db.allAsync = function(sql, params) {
  return new Promise((resolve, reject) => {
    this.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
};

// Configurações do Express
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Filtros e formatações globais
app.locals.formatDate = (timestamp) => {
  if (!timestamp) return 'N/A';
  return moment(timestamp).format('DD/MM/YYYY HH:mm:ss');
};

app.locals.formatChatTime = (timestamp) => {
  if (!timestamp) return 'N/A';
  return moment(timestamp).format('HH:mm');
};

app.locals.cleanJid = (jid) => {
  if (!jid) return 'N/A';
  if (typeof jid !== 'string') return jid;
  return jid.replace('@s.whatsapp.net', '');
};

app.locals.setores = {
  '1': 'Administrativo',
  '2': 'Vendas',
  '3': 'Suporte Técnico',
  '4': 'Outros Assuntos'
};

// Inicializa o banco de dados antes de iniciar o servidor
db.init().then(() => {
  console.log('✅ Banco de dados inicializado com sucesso.');

  // Rotas
  app.get('/', async (req, res) => {
    try {
      const totalAtendimentosHoje = await db.getTotalAtendimentosHoje();
      const avaliacaoMedia = await db.getAvaliacaoMedia();
      const atendentesOcupados = await db.getAtendentesOcupados();
      const mensagensRecentes = await db.db.allAsync(`SELECT * FROM mensagens ORDER BY timestamp DESC LIMIT 5`);
      const eventosRecentes = await db.db.allAsync(`SELECT * FROM eventos ORDER BY timestamp DESC LIMIT 5`);
      const avaliacoesRecentes = await db.db.allAsync(`SELECT * FROM avaliacoes ORDER BY timestamp DESC LIMIT 5`);
      const tarefasPendentesRecentes = await db.db.allAsync(`SELECT * FROM tarefas WHERE executado = 0 ORDER BY agendadoPara ASC LIMIT 5`);
      const atendidos = await db.db.allAsync(`SELECT a.*, h.codigo_atendimento FROM atendidos a LEFT JOIN historico_atendimentos h ON a.jid = h.jid AND h.fim IS NULL WHERE a.etapa = 2 LIMIT 5`);
      const atendentes = await db.getAtendentes('%');

      // --- ADDED LOGIC FOR 'filas' ---
      const filas = {};
      for (const setorId in app.locals.setores) {
        filas[setorId] = await db.buscarFila(setorId);
      }
      // --- END OF ADDED LOGIC ---

      res.render('index', {
        pageTitle: 'Dashboard',
        totalAtendimentosHoje,
        avaliacaoMedia,
        atendentesOcupados,
        mensagens: mensagensRecentes,
        eventos: eventosRecentes,
        avaliacoes: avaliacoesRecentes,
        tarefasPendentes: tarefasPendentesRecentes,
        atendidos,
        atendentes,
        filas, // <-- 'filas' is now passed to index.ejs
        setores: app.locals.setores
      });
    } catch (err) {
      console.error('Erro ao carregar Dashboard:', err);
      res.status(500).send('Erro ao carregar Dashboard: ' + err.message);
    }
  });

  app.get('/atendimentos-ativos', async (req, res) => {
    try {
      const atendidosAtualmente = await db.db.allAsync(`
        SELECT a.*, h.codigo_atendimento 
        FROM atendidos a 
        LEFT JOIN historico_atendimentos h ON a.jid = h.jid AND h.fim IS NULL 
        WHERE a.etapa = 2
      `);
      const filas = {};
      for (const setorId in app.locals.setores) {
        filas[setorId] = await db.buscarFila(setorId);
      }
      const atendentes = await db.getAtendentes('%');

      res.render('atendimentos-ativos', {
        pageTitle: 'Atendimentos Ativos',
        atendidosAtualmente,
        filas,
        atendentes,
        setores: app.locals.setores
      });
    } catch (err) {
      console.error('Erro ao carregar Atendimentos Ativos:', err);
      res.status(500).send('Erro ao carregar Atendimentos Ativos: ' + err.message);
    }
  });

  app.get('/historico-atendimentos', async (req, res) => {
    try {
      const atendenteJid = req.query.atendenteJid;
      const jid = req.query.jid;
      const codigo = req.query.codigo;
      let query = `SELECT * FROM historico_atendimentos`;
      let params = [];
      let conditions = [];

      if (atendenteJid) {
        conditions.push(`atendente = ?`);
        params.push(atendenteJid);
      }
      if (jid) {
        conditions.push(`jid LIKE ?`);
        params.push(`%${jid}%`);
      }
      if (codigo) {
        conditions.push(`codigo_atendimento = ?`);
        params.push(codigo);
      }
      if (conditions.length > 0) {
        query += ` WHERE ${conditions.join(' AND ')}`;
      }
      query += ` ORDER BY inicio DESC LIMIT 200`;

      let historico = await db.db.allAsync(query, params);
      historico = historico.map(item => {
        if (item.fim) {
          item.durationHumanized = moment.duration(item.fim - item.inicio).humanize();
        } else {
          item.durationHumanized = 'Em andamento';
        }
        return item;
      });

      const todosAtendentes = await db.getAtendentes('%');

      res.render('historico-atendimentos', {
        pageTitle: 'Histórico de Atendimentos',
        historico,
        todosAtendentes,
        selectedAtendenteJid: atendenteJid,
        searchJid: jid,
        searchCodigo: codigo,
        setores: app.locals.setores
      });
    } catch (err) {
      console.error('Erro ao carregar Histórico de Atendimentos:', err);
      res.status(500).send('Erro ao carregar histórico: ' + err.message);
    }
  });

  app.get('/atendimento/:id', async (req, res) => {
    const atendimentoId = req.params.id;
    try {
      let atendimento = await db.buscarHistoricoAtendimentoPorId(atendimentoId);
      if (!atendimento) {
        return res.status(404).send('Atendimento não encontrado.');
      }

      if (atendimento.fim) {
        atendimento.durationHumanized = moment.duration(atendimento.fim - atendimento.inicio).humanize();
      } else {
        atendimento.durationHumanized = 'Em andamento';
      }

      const mensagensDoAtendimento = await db.db.allAsync(
        `SELECT * FROM mensagens WHERE (jid = ? OR jid = ?) AND timestamp BETWEEN ? AND ? ORDER BY timestamp ASC`,
        [atendimento.jid, atendimento.atendente, atendimento.inicio, atendimento.fim || Date.now()]
      );

      const eventosDoAtendimento = await db.db.allAsync(
        `SELECT * FROM eventos WHERE (jid = ? OR jid = ?) AND timestamp BETWEEN ? AND ? ORDER BY timestamp ASC`,
        [atendimento.jid, atendimento.atendente, atendimento.inicio, atendimento.fim || Date.now()]
      );

      res.render('detalhes-atendimento', {
        pageTitle: `Atendimento #${atendimento.codigo_atendimento}`,
        atendimento,
        mensagensDoAtendimento,
        eventosDoAtendimento,
        setores: app.locals.setores
      });
    } catch (err) {
      console.error(`Erro ao carregar detalhes do atendimento ${atendimentoId}:`, err);
      res.status(500).send('Erro ao carregar detalhes do atendimento: ' + err.message);
    }
  });

  app.get('/todas-mensagens', async (req, res) => {
    try {
      const mensagens = await db.db.allAsync(`SELECT * FROM mensagens ORDER BY timestamp DESC LIMIT 200`);
      res.render('ultimas-mensagens', { pageTitle: 'Todas as Mensagens', mensagens });
    } catch (err) {
      console.error('Erro ao carregar todas as mensagens:', err);
      res.status(500).send('Erro ao carregar todas as mensagens: ' + err.message);
    }
  });

  app.get('/todos-eventos', async (req, res) => {
    try {
      const eventos = await db.db.allAsync(`SELECT * FROM eventos ORDER BY timestamp DESC LIMIT 200`);
      res.render('ultimos-eventos', { pageTitle: 'Todos os Eventos', eventos });
    } catch (err) {
      console.error('Erro ao carregar todos os eventos:', err);
      res.status(500).send('Erro ao carregar todos os eventos: ' + err.message);
    }
  });

  app.get('/avaliacoes', async (req, res) => {
    try {
      const avaliacoes = await db.db.allAsync(`SELECT * FROM avaliacoes ORDER BY timestamp DESC LIMIT 200`);
      res.render('avaliacoes', { pageTitle: 'Avaliações de Atendimento', avaliacoes });
    } catch (err) {
      console.error('Erro ao carregar avaliações:', err);
      res.status(500).send('Erro ao carregar avaliações: ' + err.message);
    }
  });

  app.get('/tarefas-pendentes', async (req, res) => {
    try {
      const tarefasPendentes = await db.db.allAsync(`SELECT * FROM tarefas WHERE executado = 0 ORDER BY agendadoPara ASC LIMIT 100`);
      res.render('tarefas-pendentes', { pageTitle: 'Tarefas Pendentes', tarefasPendentes });
    } catch (err) {
      console.error('Erro ao carregar tarefas pendentes:', err);
      res.status(500).send('Erro ao carregar tarefas pendentes: ' + err.message);
    }
  });

  app.get('/gerenciar-atendentes', async (req, res) => {
    try {
      const atendentesCadastrados = await db.getAtendentes('%');
      const numerosSalvos = await db.getSavedNumbers();
      res.render('gerenciar-atendentes', {
        pageTitle: 'Gerenciar Atendentes',
        atendentes: atendentesCadastrados,
        numerosSalvos,
        setores: app.locals.setores
      });
    } catch (err) {
      console.error('Erro ao carregar página de gerenciamento de atendentes:', err);
      res.status(500).send('Erro ao carregar gerenciamento de atendentes: ' + err.message);
    }
  });

  app.post('/api/atendentes', async (req, res) => {
    const { numero, nome, setor } = req.body;
    if (!numero || !nome || !setor) {
      return res.status(400).json({ success: false, message: 'Número, nome e setor são obrigatórios.' });
    }

    const jid = numero.includes('@s.whatsapp.net') ? numero : `${numero}@s.whatsapp.net`;

    try {
      await db.setAtendente(jid, nome, setor, false);
      io.emit('update', { message: `Atendente ${nome} (${app.locals.cleanJid(jid)}) cadastrado/atualizado.`, reload: true });
      res.json({ success: true, message: 'Atendente cadastrado/atualizado com sucesso!' });
    } catch (err) {
      console.error('Erro ao cadastrar/atualizar atendente:', err);
      res.status(500).json({ success: false, message: 'Erro interno ao cadastrar/atualizar atendente.' });
    }
  });

  app.put('/api/atendentes/:jid/status', async (req, res) => {
    const jid = req.params.jid.includes('@s.whatsapp.net') ? req.params.jid : `${req.params.jid}@s.whatsapp.net`;
    const { ocupado } = req.body;

    if (typeof ocupado !== 'boolean') {
      return res.status(400).json({ success: false, message: 'Status "ocupado" inválido. Deve ser true ou false.' });
    }

    try {
      const atendente = await db.buscarAtendente(jid);
      if (!atendente) {
        return res.status(404).json({ success: false, message: 'Atendente não encontrado.' });
      }

      await db.setAtendente(jid, atendente.nome, atendente.setor, ocupado);
      io.emit('update', { message: `Status do atendente ${atendente.nome} (${app.locals.cleanJid(jid)}) atualizado para ${ocupado ? 'Ocupado' : 'Disponível'}.`, reload: true });
      res.json({ success: true, message: `Status do atendente ${atendente.nome} (${app.locals.cleanJid(jid)}) atualizado para ${ocupado ? 'Ocupado' : 'Disponível'}.` });
    } catch (err) {
      console.error('Erro ao atualizar status do atendente:', err);
      res.status(500).json({ success: false, message: 'Erro interno ao atualizar status do atendente.' });
    }
  });

  app.delete('/api/atendentes/:jid', async (req, res) => {
    const jid = req.params.jid.includes('@s.whatsapp.net') ? req.params.jid : `${req.params.jid}@s.whatsapp.net`;
    try {
      const removed = await db.removerAtendente(jid);
      if (removed) {
        io.emit('update', { message: `Atendente ${app.locals.cleanJid(jid)} removido.`, reload: true });
        res.json({ success: true, message: 'Atendente removido com sucesso!' });
      } else {
        res.status(404).json({ success: false, message: 'Atendente não encontrado.' });
      }
    } catch (err) {
      console.error('Erro ao remover atendente:', err);
      res.status(500).json({ success: false, message: 'Erro interno ao remover atendente.' });
    }
  });

  app.post('/api/atendimentos/:jid/encerrar', async (req, res) => {
    const jid = req.params.jid.includes('@s.whatsapp.net') ? req.params.jid : `${req.params.jid}@s.whatsapp.net`;
    try {
      const atendimento = await db.buscarAtendido(jid);
      if (!atendimento) {
        return res.status(404).json({ success: false, message: 'Atendimento não encontrado.' });
      }

      const codigo = await db.buscarCodigoAtendimento(jid, atendimento.setor);
      await db.registrarFimAtendimento(jid);
      await db.removerAtendido(jid);
      await db.removerFila(jid);
      if (atendimento.atendente) {
        await db.setAtendente(atendimento.atendente, (await db.buscarAtendente(atendimento.atendente)).nome, atendimento.setor, false);
      }
      io.emit('update', { message: `Atendimento ${codigo} (${app.locals.cleanJid(jid)}) encerrado pelo painel.`, reload: true });
      res.json({ success: true, message: `Atendimento ${codigo} encerrado com sucesso!` });
    } catch (err) {
      console.error('Erro ao encerrar atendimento:', err);
      res.status(500).json({ success: false, message: 'Erro interno ao encerrar atendimento.' });
    }
  });

  app.post('/api/atendimentos/transferir', async (req, res) => {
    const { jid, setor } = req.body;
    if (!jid || !setor) {
      return res.status(400).json({ success: false, message: 'JID e setor são obrigatórios.' });
    }

    try {
      const atendimento = await db.buscarAtendido(jid);
      if (!atendimento) {
        return res.status(404).json({ success: false, message: 'Atendimento não encontrado.' });
      }

      const codigo = await db.buscarCodigoAtendimento(jid, atendimento.setor);
      await db.salvarAtendido({
        jid,
        etapa: 2,
        ultimaInteracao: Date.now(),
        setor,
        atendente: null,
        avaliacaoPendente: false,
        confirmacaoPendente: null,
        nomeCliente: atendimento.nomeCliente
      });
      await db.adicionarFila(jid, setor);
      if (atendimento.atendente) {
        await db.setAtendente(atendimento.atendente, (await db.buscarAtendente(atendimento.atendente)).nome, atendimento.setor, false);
      }
      await db.registrarEvento('transferencia_setor', jid, setor, `Transferido do setor ${app.locals.setores[atendimento.setor]} para ${app.locals.setores[setor]} (Código: ${codigo})`);
      io.emit('update', { message: `Atendimento ${codigo} (${app.locals.cleanJid(jid)}) transferido para ${app.locals.setores[setor]}.`, reload: true });
      res.json({ success: true, message: `Atendimento ${codigo} transferido com sucesso!` });
    } catch (err) {
      console.error('Erro ao transferir atendimento:', err);
      res.status(500).json({ success: false, message: 'Erro interno ao transferir atendimento.' });
    }
  });

  app.post('/api/atendimentos/reabrir', async (req, res) => {
    const { jid, setor } = req.body;
    if (!jid || !setor) {
      return res.status(400).json({ success: false, message: 'JID e setor são obrigatórios.' });
    }

    try {
      const atendimento = await db.buscarAtendido(jid);
      if (atendimento && atendimento.etapa === 2) {
        return res.status(400).json({ success: false, message: 'Atendimento já está ativo.' });
      }

      const { id, codigo } = await db.registrarInicioAtendimento(jid, setor, null);
      await db.salvarAtendido({
        jid,
        etapa: 2,
        ultimaInteracao: Date.now(),
        setor,
        atendente: null,
        avaliacaoPendente: false,
        confirmacaoPendente: null,
        nomeCliente: null
      });
      await db.adicionarFila(jid, setor);
      await db.registrarEvento('atendimento_reaberto', jid, setor, `Atendimento reaberto com código ${codigo}`);
      io.emit('update', { message: `Atendimento ${codigo} (${app.locals.cleanJid(jid)}) reaberto no setor ${app.locals.setores[setor]}.`, reload: true });
      res.json({ success: true, message: `Atendimento ${codigo} reaberto com sucesso!` });
    } catch (err) {
      console.error('Erro ao reabrir atendimento:', err);
      res.status(500).json({ success: false, message: 'Erro interno ao reabrir atendimento.' });
    }
  });

  app.get('/api/atendimentos/status/:codigo', async (req, res) => {
    const codigo = req.params.codigo;
    try {
      const atendimento = await db.buscarHistoricoAtendimentoPorCodigo(codigo);
      if (!atendimento) {
        return res.status(404).json({ success: false, message: 'Atendimento não encontrado.' });
      }

      const status = atendimento.fim ? 'Encerrado' : (await db.buscarAtendido(atendimento.jid))?.etapa === 2 ? 'Ativo' : 'Na Fila';
      res.json({
        success: true,
        atendimento: {
          codigo_atendimento: atendimento.codigo_atendimento,
          cliente: app.locals.cleanJid(atendimento.jid),
          setor: app.locals.setores[atendimento.setor] || 'N/A',
          atendente: atendimento.atendente ? app.locals.cleanJid(atendimento.atendente) : 'N/A',
          inicio: app.locals.formatDate(atendimento.inicio),
          fim: atendimento.fim ? app.locals.formatDate(atendimento.fim) : 'N/A',
          status
        }
      });
    } catch (err) {
      console.error('Erro ao consultar status do atendimento:', err);
      res.status(500).json({ success: false, message: 'Erro interno ao consultar status.' });
    }
  });

  app.post('/api/numeros-salvos', async (req, res) => {
    const { numero } = req.body;
    if (!numero) {
      return res.status(400).json({ success: false, message: 'O número é obrigatório.' });
    }
    try {
      const result = await db.addSavedNumber(numero);
      io.emit('update', { message: `Número ${numero} salvo com sucesso!`, reload: true });
      res.status(201).json({ success: true, message: 'Número salvo com sucesso!', data: result });
    } catch (err) {
      console.error('Erro ao salvar número:', err);
      if (err.message.includes('Número já existe')) {
        return res.status(409).json({ success: false, message: 'Este número já está salvo.' });
      }
      res.status(500).json({ success: false, message: 'Erro interno ao salvar número.' });
    }
  });

  app.get('/api/numeros-salvos', async (req, res) => {
    try {
      const numeros = await db.getSavedNumbers();
      res.json({ success: true, data: numeros });
    } catch (err) {
      console.error('Erro ao buscar números salvos:', err);
      res.status(500).json({ success: false, message: 'Erro interno ao buscar números salvos.' });
    }
  });

  app.delete('/api/numeros-salvos/:id', async (req, res) => {
    const { id } = req.params;
    try {
      const removed = await db.deleteSavedNumber(id);
      if (removed) {
        io.emit('update', { message: `Número removido com sucesso!`, reload: true });
        res.json({ success: true, message: 'Número removido com sucesso!' });
      } else {
        res.status(404).json({ success: false, message: 'Número salvo não encontrado.' });
      }
    } catch (err) {
      console.error('Erro ao remover número salvo:', err);
      res.status(500).json({ success: false, message: 'Erro interno ao remover número salvo.' });
    }
  });

  // Inicia o servidor após a inicialização do banco
  server.listen(PORT, () => {
    console.log(`✅ Painel Tracker CarSat rodando em http://localhost:${PORT}`);
  });

}).catch((err) => {
  console.error('Erro ao inicializar o banco de dados:', err);
  process.exit(1); // Encerra o processo se a inicialização falhar
});