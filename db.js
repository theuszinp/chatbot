const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const moment = require('moment');

const dbPath = path.resolve(__dirname, 'atendimento.db');
const db = new sqlite3.Database(dbPath);

/**
 * Inicializa o banco de dados, criando todas as tabelas necessárias
 * se elas ainda não existirem e garantindo que a coluna codigo_atendimento
 * esteja presente em historico_atendimentos.
 * @returns {Promise<void>} Uma Promise que resolve quando a inicialização é concluída.
 */
function init() {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      // Tabela para gerenciar o estado atual de cada atendimento de cliente
      db.run(`
        CREATE TABLE IF NOT EXISTS atendidos (
          jid TEXT PRIMARY KEY,           -- JID (ID do WhatsApp) do cliente
          etapa INTEGER,                  -- Etapa atual do atendimento (0: menu, 1: escolhendo setor, 2: em atendimento/fila, 3: avaliacao, 4: aguardando confirmacao)
          ultimaInteracao INTEGER,        -- Timestamp da última interação do cliente
          setor TEXT,                     -- Setor ao qual o cliente está vinculado (1, 2, 3)
          atendente TEXT,                 -- JID do atendente que está atendendo o cliente (NULL se na fila)
          avaliacaoPendente INTEGER,      -- 0: não pendente, 1: pendente de avaliação
          confirmacaoPendente TEXT,       -- Tipo de confirmação pendente (ex: 'encerrar_atendente', 'encerrar_cliente', NULL)
          nomeCliente TEXT                -- Nome do cliente
        )
      `);

      // Tabela para gerenciar a fila de espera de clientes por setor
      db.run(`
        CREATE TABLE IF NOT EXISTS fila (
          id INTEGER PRIMARY KEY AUTOINCREMENT, -- ID incremental para ordenar a fila (FIFO)
          jid TEXT,                             -- JID do cliente na fila
          setor TEXT                            -- Setor da fila
        )
      `);
      db.run(`CREATE INDEX IF NOT EXISTS idx_fila_setor ON fila (setor);`);

      // Tabela para gerenciar os atendentes e seus status
      db.run(`
        CREATE TABLE IF NOT EXISTS atendentes (
          jid TEXT PRIMARY KEY,           -- JID do atendente
          nome TEXT,                      -- Nome amigável do atendente
          setor TEXT,                     -- Setor ao qual o atendente pertence
          ocupado INTEGER                 -- 0: disponível, 1: ocupado
        )
      `);
      db.run(`CREATE INDEX IF NOT EXISTS idx_atendentes_setor_ocupado ON atendentes (setor, ocupado);`);

      // Tabela para registrar todas as mensagens (para auditoria/histórico de conversas)
      db.run(`
        CREATE TABLE IF NOT EXISTS mensagens (
          id INTEGER PRIMARY KEY AUTOINCREMENT, -- ID da mensagem
          jid TEXT,                             -- JID do remetente/destinatário
          direcao TEXT,                         -- 'entrada' ou 'saida'
          mensagem TEXT,                        -- Conteúdo da mensagem (texto ou legenda da mídia)
          tipo_midia TEXT,                      -- Tipo da mídia (ex: 'image', 'video', 'audio', 'sticker', 'document')
          caminho_midia TEXT,                   -- Caminho local do arquivo de mídia (ex: '/media/img_123.jpg')
          timestamp INTEGER,                    -- Timestamp do registro
          nomeCliente TEXT                      -- Nome do cliente
        )
      `);
      db.run(`CREATE INDEX IF NOT EXISTS idx_mensagens_jid ON mensagens (jid);`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_mensagens_timestamp ON mensagens (timestamp);`);

      // Tabela para registrar eventos importantes do sistema
      db.run(`
        CREATE TABLE IF NOT EXISTS eventos (
          id INTEGER PRIMARY KEY AUTOINCREMENT, -- ID do evento
          tipo TEXT,                            -- Tipo do evento (ex: 'atendimento_iniciado', 'fila_adicionado')
          jid TEXT,                             -- JID relacionado ao evento
          setor TEXT,                           -- Setor relacionado (opcional)
          detalhes TEXT,                        -- Detalhes adicionais do evento (JSON ou texto)
          timestamp INTEGER                     -- Timestamp do evento
        )
      `);
      db.run(`CREATE INDEX IF NOT EXISTS idx_eventos_jid ON eventos (jid);`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_eventos_timestamp ON eventos (timestamp);`);

      // Tabela para armazenar as avaliações dos clientes
      db.run(`
        CREATE TABLE IF NOT EXISTS avaliacoes (
          id INTEGER PRIMARY KEY AUTOINCREMENT, -- ID da avaliação
          jid TEXT,                             -- JID do cliente que avaliou
          atendente TEXT,                       -- JID do atendente avaliado
          setor TEXT,                           -- Setor do atendimento avaliado
          nota INTEGER,                         -- Nota de 1 a 5
          comentario TEXT,                      -- Comentário (opcional)
          timestamp INTEGER                     -- Timestamp da avaliação
        )
      `);
      db.run(`CREATE INDEX IF NOT EXISTS idx_avaliacoes_atendente ON avaliacoes (atendente);`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_avaliacoes_setor ON avaliacoes (setor);`);

      // Tabela para manter um histórico detalhado de cada atendimento
      db.run(`
        CREATE TABLE IF NOT EXISTS historico_atendimentos (
          id INTEGER PRIMARY KEY AUTOINCREMENT, -- ID do registro de histórico
          jid TEXT,                             -- JID do cliente
          setor TEXT,                           -- Setor do atendimento
          atendente TEXT,                       -- JID do atendente (se houver)
          inicio INTEGER,                       -- Timestamp do início do atendimento
          fim INTEGER,                          -- Timestamp do fim do atendimento
          duracao INTEGER,                      -- Duração do atendimento em milissegundos
          codigo_atendimento TEXT UNIQUE        -- Código único do atendimento (ex: ATD-000001-2025)
        )
      `);
      db.run(`CREATE INDEX IF NOT EXISTS idx_historico_jid ON historico_atendimentos (jid);`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_historico_atendente ON historico_atendimentos (atendente);`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_historico_codigo ON historico_atendimentos (codigo_atendimento);`);

      // Verificar e adicionar a coluna codigo_atendimento se não existir
      db.all("PRAGMA table_info(historico_atendimentos)", (err, columns) => {
        if (err) {
          console.error('Erro ao verificar esquema de historico_atendimentos:', err.message);
          return reject(err); // Rejeita a Promise em caso de erro
        }
        console.log('Colunas retornadas por PRAGMA table_info:', columns);
        if (!Array.isArray(columns) || columns.length === 0) {
          console.error('PRAGMA table_info não retornou um array válido ou está vazio:', columns);
          db.run(`ALTER TABLE historico_atendimentos ADD COLUMN codigo_atendimento TEXT`, (err) => {
            if (err) {
              if (err.message.includes('duplicate column name')) {
                console.log('Coluna codigo_atendimento já existe, pulando adição.');
              } else {
                console.error('Erro ao adicionar coluna codigo_atendimento:', err.message);
                return reject(err); // Rejeita a Promise
              }
            } else {
              console.log('Coluna codigo_atendimento adicionada com sucesso.');
            }
            db.run(`
              UPDATE historico_atendimentos 
              SET codigo_atendimento = 'ATD-' || printf('%06d', id) || '-' || strftime('%Y', 'now')
              WHERE codigo_atendimento IS NULL
            `, (err) => {
              if (err) {
                console.error('Erro ao preencher codigo_atendimento:', err.message);
                return reject(err); // Rejeita a Promise
              } else {
                console.log('Códigos de atendimento preenchidos para registros existentes.');
              }
              resolve(); // Resolve a Promise após completar
            });
          });
          return;
        }
        const hasCodigoAtendimento = columns.some(col => col.name === 'codigo_atendimento');
        if (!hasCodigoAtendimento) {
          console.log('Adicionando coluna codigo_atendimento à tabela historico_atendimentos...');
          db.run(`ALTER TABLE historico_atendimentos ADD COLUMN codigo_atendimento TEXT`, (err) => {
            if (err) {
              if (err.message.includes('duplicate column name')) {
                console.log('Coluna codigo_atendimento já existe, pulando adição.');
              } else {
                console.error('Erro ao adicionar coluna codigo_atendimento:', err.message);
                return reject(err); // Rejeita a Promise
              }
            } else {
              console.log('Coluna codigo_atendimento adicionada com sucesso.');
            }
            db.run(`
              UPDATE historico_atendimentos 
              SET codigo_atendimento = 'ATD-' || printf('%06d', id) || '-' || strftime('%Y', 'now')
              WHERE codigo_atendimento IS NULL
            `, (err) => {
              if (err) {
                console.error('Erro ao preencher codigo_atendimento:', err.message);
                return reject(err); // Rejeita a Promise
              } else {
                console.log('Códigos de atendimento preenchidos para registros existentes.');
              }
              resolve(); // Resolve a Promise após completar
            });
          });
        } else {
          console.log('Coluna codigo_atendimento já existe na tabela historico_atendimentos.');
          db.run(`
            UPDATE historico_atendimentos 
            SET codigo_atendimento = 'ATD-' || printf('%06d', id) || '-' || strftime('%Y', 'now')
            WHERE codigo_atendimento IS NULL
          `, (err) => {
            if (err) {
              console.error('Erro ao preencher codigo_atendimento:', err.message);
              return reject(err); // Rejeita a Promise
            } else {
              console.log('Códigos de atendimento preenchidos para registros existentes.');
            }
            resolve(); // Resolve a Promise após completar
          });
        }
      });

      // Tabela para agendamento de tarefas futuras
      db.run(`
        CREATE TABLE IF NOT EXISTS tarefas (
          id INTEGER PRIMARY KEY AUTOINCREMENT, -- ID da tarefa
          jid TEXT,                             -- JID relacionado à tarefa
          acao TEXT,                            -- Descrição ou tipo de ação a ser executada
          agendadoPara INTEGER,                 -- Timestamp para quando a tarefa deve ser executada
          executado INTEGER DEFAULT 0,          -- 0: pendente, 1: executada
          executadoEm INTEGER                   -- Timestamp de quando foi executada (se aplicável)
        )
      `);
      db.run(`CREATE INDEX IF NOT EXISTS idx_tarefas_executado_agendadoPara ON tarefas (executado, agendadoPara);`);

      // Tabela para salvar números de WhatsApp favoritos
      db.run(`
        CREATE TABLE IF NOT EXISTS numeros_salvos (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          numero TEXT UNIQUE                    -- O número (JID limpo) a ser salvo
        )
      `);
    });
  });
}

// =================== OPERAÇÕES PRINCIPAIS DE ATENDIMENTO ===================

/**
 * Salva ou atualiza o estado de um atendimento de cliente.
 * Se o JID já existe, atualiza; caso contrário, insere.
 * @param {object} atendido - Objeto com os dados do atendimento (jid, etapa, ultimaInteracao, setor, atendente, avaliacaoPendente, confirmacaoPendente, nomeCliente).
 */
function salvarAtendido(atendido) {
  const { jid, etapa, ultimaInteracao, setor, atendente, avaliacaoPendente, confirmacaoPendente, nomeCliente } = atendido;
  return new Promise((resolve, reject) => {
    const query = `
      INSERT INTO atendidos (jid, etapa, ultimaInteracao, setor, atendente, avaliacaoPendente, confirmacaoPendente, nomeCliente)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(jid) DO UPDATE SET
        etapa=excluded.etapa,
        ultimaInteracao=excluded.ultimaInteracao,
        setor=excluded.setor,
        atendente=excluded.atendente,
        avaliacaoPendente=excluded.avaliacaoPendente,
        confirmacaoPendente=excluded.confirmacaoPendente,
        nomeCliente=excluded.nomeCliente
    `;
    db.run(query, [jid, etapa, ultimaInteracao, setor, atendente, avaliacaoPendente ? 1 : 0, confirmacaoPendente, nomeCliente], function(err) {
      if (err) reject(err);
      else resolve();
    });
  });
}

/**
 * Remove um registro de atendimento de cliente.
 * @param {string} jid - O JID do cliente a ser removido.
 */
function removerAtendido(jid) {
  return new Promise((resolve, reject) => {
    db.run(`DELETE FROM atendidos WHERE jid = ?`, [jid], function(err) {
      if (err) reject(err);
      else resolve();
    });
  });
}

/**
 * Busca o estado de atendimento de um cliente.
 * @param {string} jid - O JID do cliente.
 * @returns {Promise<object|null>} O objeto de atendimento ou null se não encontrado.
 */
function buscarAtendido(jid) {
  return new Promise((resolve, reject) => {
    db.get(`SELECT * FROM atendidos WHERE jid = ?`, [jid], (err, row) => {
      if (err) reject(err);
      else {
        if (row) row.avaliacaoPendente = row.avaliacaoPendente === 1;
        resolve(row);
      }
    });
  });
}

/**
 * Adiciona um cliente à fila de espera de um setor.
 * @param {string} jid - O JID do cliente.
 * @param {string} setor - O setor da fila.
 */
function adicionarFila(jid, setor) {
  return new Promise((resolve, reject) => {
    db.run(`INSERT INTO fila (jid, setor) VALUES (?, ?)`, [jid, setor], function(err) {
      if (err) reject(err);
      else resolve();
    });
  });
}

/**
 * Remove um cliente da fila de espera.
 * @param {string} jid - O JID do cliente a ser removido.
 */
function removerFila(jid) {
  return new Promise((resolve, reject) => {
    db.run(`DELETE FROM fila WHERE jid = ?`, [jid], function(err) {
      if (err) reject(err);
      else resolve();
    });
  });
}

/**
 * Busca a lista de JIDs de clientes na fila para um setor específico.
 * @param {string} setor - O setor da fila.
 * @returns {Promise<string[]>} Um array de JIDs na ordem da fila.
 */
function buscarFila(setor) {
  return new Promise((resolve, reject) => {
    db.all(`SELECT jid FROM fila WHERE setor = ? ORDER BY id ASC`, [setor], (err, rows) => {
      if (err) reject(err);
      else resolve(rows.map(r => r.jid));
    });
  });
}

/**
 * Define ou atualiza o status e nome de um atendente.
 * @param {string} jid - O JID do atendente.
 * @param {string} nome - O nome amigável do atendente.
 * @param {string} setor - O setor do atendente.
 * @param {boolean} ocupado - true se ocupado, false se disponível.
 */
function setAtendente(jid, nome, setor, ocupado) {
  return new Promise((resolve, reject) => {
    const query = `
      INSERT INTO atendentes (jid, nome, setor, ocupado)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(jid) DO UPDATE SET nome=excluded.nome, setor=excluded.setor, ocupado=excluded.ocupado
    `;
    db.run(query, [jid, nome, setor, ocupado ? 1 : 0], function(err) {
      if (err) reject(err);
      else resolve();
    });
  });
}

/**
 * Busca todos os atendentes de um setor ou todos se setor for '%'.
 * @param {string} setor - O setor para buscar atendentes. Use '%' para todos.
 * @returns {Promise<object[]>} Um array de objetos de atendentes.
 */
function getAtendentes(setor) {
  return new Promise((resolve, reject) => {
    const query = setor === '%' ? `SELECT * FROM atendentes` : `SELECT * FROM atendentes WHERE setor = ?`;
    const params = setor === '%' ? [] : [setor];

    db.all(query, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

/**
 * Busca um atendente disponível (não ocupado) para um setor.
 * @param {string} setor - O setor para buscar.
 * @returns {Promise<object|null>} O objeto do atendente disponível ou null.
 */
function getAtendenteDisponivel(setor) {
  return new Promise((resolve, reject) => {
    db.get(`SELECT * FROM atendentes WHERE setor = ? AND ocupado = 0 LIMIT 1`, [setor], (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

/**
 * Retorna o JID do cliente que está sendo atendido por um atendente específico,
 * considerando tanto a etapa de atendimento ativo quanto a de confirmação de encerramento.
 * @param {string} atendenteJid - O JID do atendente.
 * @returns {Promise<string|null>} O JID do cliente ou null.
 */
async function buscarClientePorAtendente(atendenteJid) {
  return new Promise((resolve, reject) => {
    db.get(`SELECT jid FROM atendidos WHERE atendente = ? AND (etapa = 2 OR etapa = 4)`, [atendenteJid], (err, row) => {
      if (err) reject(err);
      else resolve(row?.jid || null);
    });
  });
}

/**
 * Busca as informações de um atendente pelo JID.
 * @param {string} jid - O JID do atendente.
 * @returns {Promise<object|null>} O objeto do atendente ou null.
 */
function buscarAtendente(jid) {
  return new Promise((resolve, reject) => {
    db.get(`SELECT * FROM atendentes WHERE jid = ?`, [jid], (err, row) => {
      if (err) reject(err);
      else resolve(row || null);
    });
  });
}

/**
 * Remove um atendente pelo JID.
 * @param {string} jid - O JID do atendente a ser removido.
 * @returns {Promise<boolean>} True se removido com sucesso, false caso contrário.
 */
function removerAtendente(jid) {
  return new Promise((resolve, reject) => {
    db.run(`DELETE FROM atendentes WHERE jid = ?`, [jid], function(err) {
      if (err) reject(err);
      else resolve(this.changes > 0);
    });
  });
}

// =================== OPERAÇÕES DE MONITORAMENTO E HISTÓRICO ===================

/**
 * Registra uma mensagem no histórico, incluindo informações de mídia.
 * @param {string} jid - O JID do cliente/atendente.
 * @param {string} direcao - 'entrada' ou 'saida'.
 * @param {string} mensagem - O conteúdo da mensagem (texto ou legenda da mídia).
 * @param {string} [tipoMidia=null] - Tipo da mídia (ex: 'image', 'video').
 * @param {string} [caminhoMidia=null] - Caminho local do arquivo de mídia.
 * @param {string} [nomeCliente=null] - Nome do cliente.
 * @param {number} [timestamp=Date.now()] - O timestamp da mensagem.
 */
function registrarMensagem(jid, direcao, mensagem, tipoMidia = null, caminhoMidia = null, nomeCliente = null, timestamp = Date.now()) {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO mensagens (jid, direcao, mensagem, tipo_midia, caminho_midia, nomeCliente, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [jid, direcao, mensagem, tipoMidia, caminhoMidia, nomeCliente, timestamp],
      function(err) {
        if (err) reject(err);
        else resolve();
      }
    );
  });
}

/**
 * Registra um evento importante no sistema.
 * @param {string} tipo - O tipo do evento (ex: 'atendimento_iniciado', 'fila_adicionado').
 * @param {string} jid - O JID relacionado ao evento.
 * @param {string} [setor=null] - O setor relacionado ao evento (opcional).
 * @param {string} [detalhes=null] - Detalhes adicionais do evento (JSON string ou texto).
 * @param {number} [timestamp=Date.now()] - O timestamp do evento.
 */
function registrarEvento(tipo, jid, setor = null, detalhes = null, timestamp = Date.now()) {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO eventos (tipo, jid, setor, detalhes, timestamp) VALUES (?, ?, ?, ?, ?)`,
      [tipo, jid, setor, detalhes, timestamp],
      function(err) {
        if (err) reject(err);
        else resolve();
      }
    );
  });
}

/**
 * Salva uma avaliação de atendimento.
 * @param {string} jid - JID do cliente que avaliou.
 * @param {string} atendente - JID do atendente avaliado.
 * @param {string} setor - Setor do atendimento.
 * @param {number} nota - Nota de 1 a 5.
 * @param {string} [comentario=''] - Comentário adicional.
 * @param {number} [timestamp=Date.now()] - Timestamp da avaliação.
 */
function salvarAvaliacao(jid, atendente, setor, nota, comentario = '', timestamp = Date.now()) {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO avaliacoes (jid, atendente, setor, nota, comentario, timestamp) VALUES (?, ?, ?, ?, ?, ?)`,
      [jid, atendente, setor, nota, comentario, timestamp],
      function(err) {
        if (err) reject(err);
        else resolve();
      }
    );
  });
}

/**
 * Gera um código de atendimento único com base no ID do atendimento.
 * @param {number} id - O ID do registro de atendimento.
 * @returns {string} O código no formato ATD-<id>-<ano>.
 */
function gerarCodigoAtendimento(id) {
  const ano = new Date().getFullYear();
  return `ATD-${id.toString().padStart(6, '0')}-${ano}`;
}

/**
 * Registra o início de um atendimento no histórico.
 * @param {string} jid - JID do cliente.
 * @param {string} setor - Setor do atendimento.
 * @param {string} atendente - JID do atendente.
 * @param {number} [inicio=Date.now()] - Timestamp do início.
 * @returns {Promise<object>} Objeto com o ID e o código do atendimento.
 */
function registrarInicioAtendimento(jid, setor, atendente, inicio = Date.now()) {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO historico_atendimentos (jid, setor, atendente, inicio) VALUES (?, ?, ?, ?)`,
      [jid, setor, atendente, inicio],
      function(err) {
        if (err) return reject(err);
        const id = this.lastID;
        const codigo = gerarCodigoAtendimento(id);
        db.run(
          `UPDATE historico_atendimentos SET codigo_atendimento = ? WHERE id = ?`,
          [codigo, id],
          err => {
            if (err) return reject(err);
            resolve({ id, codigo });
          }
        );
      }
    );
  });
}

/**
 * Registra o fim de um atendimento no histórico e calcula a duração.
 * Atualiza o registro mais recente para aquele JID onde 'fim' ainda é NULL.
 * @param {string} jid - JID do cliente.
 * @param {number} [fim=Date.now()] - Timestamp do fim.
 */
function registrarFimAtendimento(jid, fim = Date.now()) {
  return new Promise((resolve, reject) => {
    db.run(
      `UPDATE historico_atendimentos SET fim = ?, duracao = ? - inicio WHERE jid = ? AND fim IS NULL`,
      [fim, fim, jid],
      function(err) {
        if (err) reject(err);
        else resolve(this.changes > 0);
      }
    );
  });
}

/**
 * Busca o código de atendimento ativo para um cliente e setor.
 * @param {string} jid - JID do cliente.
 * @param {string} setor - Setor do atendimento.
 * @returns {Promise<string|null>} O código do atendimento ou null se não encontrado.
 */
function buscarCodigoAtendimento(jid, setor) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT codigo_atendimento FROM historico_atendimentos WHERE jid = ? AND setor = ? AND fim IS NULL`,
      [jid, setor],
      (err, row) => {
        if (err) return reject(err);
        resolve(row ? row.codigo_atendimento : null);
      }
    );
  });
}

/**
 * Busca um atendimento no histórico pelo ID.
 * @param {number} id - O ID do histórico de atendimento.
 * @returns {Promise<object|null>} O objeto do atendimento ou null se não encontrado.
 */
function buscarHistoricoAtendimentoPorId(id) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT * FROM historico_atendimentos WHERE id = ?`,
      [id],
      (err, row) => {
        if (err) {
          console.error('Erro ao buscar histórico de atendimento por ID:', err.message);
          reject(err);
        } else {
          resolve(row);
        }
      }
    );
  });
}

/**
 * Busca um atendimento no histórico pelo código de atendimento.
 * @param {string} codigo - O código do atendimento (ex: ATD-000001-2025).
 * @returns {Promise<object|null>} O objeto do atendimento ou null se não encontrado.
 */
function buscarHistoricoAtendimentoPorCodigo(codigo) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT * FROM historico_atendimentos WHERE codigo_atendimento = ?`,
      [codigo],
      (err, row) => {
        if (err) {
          console.error('Erro ao buscar histórico de atendimento por código:', err.message);
          reject(err);
        } else {
          resolve(row);
        }
      }
    );
  });
}

// =================== OPERAÇÕES DE TAREFAS AGENDADAS ===================

/**
 * Agenda uma tarefa para ser executada no futuro.
 * @param {string} jid - JID relacionado à tarefa.
 * @param {string} acao - Descrição da ação a ser realizada.
 * @param {number} agendadoPara - Timestamp para quando a tarefa deve ser executada.
 */
function agendarTarefa(jid, acao, agendadoPara) {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO tarefas (jid, acao, agendadoPara) VALUES (?, ?, ?)`,
      [jid, acao, agendadoPara],
      function(err) {
        if (err) reject(err);
        else resolve(this.lastID);
      }
    );
  });
}

/**
 * Marca uma tarefa como concluída.
 * @param {number} id - O ID da tarefa.
 * @param {number} [executadoEm=Date.now()] - Timestamp de quando a tarefa foi executada.
 */
function concluirTarefa(id, executadoEm = Date.now()) {
  return new Promise((resolve, reject) => {
    db.run(
      `UPDATE tarefas SET executado = 1, executadoEm = ? WHERE id = ?`,
      [executadoEm, id],
      function(err) {
        if (err) reject(err);
        else resolve(this.changes > 0);
      }
    );
  });
}

/**
 * Busca todas as tarefas pendentes, ordenadas pela data de agendamento.
 * @returns {Promise<object[]>} Um array de objetos de tarefas pendentes.
 */
function buscarTarefasPendentes() {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT * FROM tarefas WHERE executado = 0 ORDER BY agendadoPara ASC`,
      [],
      (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      }
    );
  });
}

// =================== RELATÓRIOS E ESTATÍSTICAS ===================

/**
 * Obtém o histórico de atendimentos para um JID específico.
 * @param {string} jid - O JID do cliente.
 * @returns {Promise<object[]>} Um array de registros de histórico.
 */
function obterHistoricoPorJid(jid) {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT * FROM historico_atendimentos WHERE jid = ? ORDER BY inicio DESC`,
      [jid],
      (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      }
    );
  });
}

/**
 * Obtém estatísticas gerais do sistema.
 * @returns {Promise<object>} Um objeto com estatísticas.
 */
function obterEstatisticas() {
  return new Promise((resolve, reject) => {
    const stats = {};
    db.serialize(() => {
      db.get(`SELECT COUNT(*) as total FROM atendentes`, (err, row) => {
        if (err) return reject(err);
        stats.atendentes = row.total;

        db.get(`SELECT COUNT(*) as total FROM fila`, (err, row) => {
          if (err) return reject(err);
          stats.fila = row.total;

          db.get(`SELECT COUNT(*) as total FROM mensagens`, (err, row) => {
            if (err) return reject(err);
            stats.mensagens = row.total;

            db.get(`SELECT COUNT(*) as total FROM avaliacoes`, (err, row) => {
              if (err) return reject(err);
              stats.avaliacoes = row.total;

              resolve(stats);
            });
          });
        });
      });
    });
  });
}

/**
 * Retorna o número total de atendimentos concluídos hoje.
 * @returns {Promise<number>} O total de atendimentos.
 */
function getTotalAtendimentosHoje() {
  return new Promise((resolve, reject) => {
    const todayStart = moment().startOf('day').valueOf();
    db.get(
      `SELECT COUNT(*) AS total FROM historico_atendimentos WHERE fim IS NOT NULL AND fim >= ?`,
      [todayStart],
      (err, row) => {
        if (err) {
          console.error('Erro ao buscar total de atendimentos hoje:', err.message);
          reject(err);
        } else {
          resolve(row ? row.total : 0);
        }
      }
    );
  });
}

/**
 * Retorna a avaliação média dos atendimentos.
 * @returns {Promise<string>} A avaliação média formatada ou 'N/A'.
 */
function getAvaliacaoMedia() {
  return new Promise((resolve, reject) => {
    db.get(`SELECT AVG(nota) AS media FROM avaliacoes`, (err, row) => {
      if (err) {
        console.error('Erro ao buscar avaliação média:', err.message);
        reject(err);
      } else {
        resolve(row && row.media ? parseFloat(row.media).toFixed(2) : 'N/A');
      }
    });
  });
}

/**
 * Retorna a lista de atendentes atualmente ocupados.
 * @returns {Promise<Array<object>>} Uma lista de atendentes ocupados (jid, setor).
 */
function getAtendentesOcupados() {
  return new Promise((resolve, reject) => {
    db.all(`SELECT jid, setor FROM atendentes WHERE ocupado = 1`, (err, rows) => {
      if (err) {
        console.error('Erro ao buscar atendentes ocupados:', err.message);
        reject(err);
      } else {
        resolve(rows);
      }
    });
  });
}

// =================== NOVAS FUNÇÕES PARA NÚMEROS SALVOS ===================

/**
 * Adiciona um número de WhatsApp à tabela de números salvos.
 * @param {string} numero - O número de WhatsApp (JID limpo) a ser salvo.
 * @returns {Promise<object>} Um objeto com o id e o número salvo.
 */
function addSavedNumber(numero) {
  return new Promise((resolve, reject) => {
    db.run(`INSERT INTO numeros_salvos (numero) VALUES (?)`, [numero], function(err) {
      if (err) {
        if (err.errno === 19) {
          reject(new Error('Número já existe nos favoritos.'));
        } else {
          reject(err);
        }
      } else {
        resolve({ id: this.lastID, numero });
      }
    });
  });
}

/**
 * Busca todos os números salvos.
 * @returns {Promise<Array<object>>} Um array de objetos com id e numero.
 */
function getSavedNumbers() {
  return new Promise((resolve, reject) => {
    db.all(`SELECT id, numero FROM numeros_salvos ORDER BY numero ASC`, [], (err, rows) => {
      if (err) {
        reject(err);
      } else {
        resolve(rows);
      }
    });
  });
}

/**
 * Remove um número salvo pelo seu ID.
 * @param {number} id - O ID do número a ser removido.
 * @returns {Promise<boolean>} True se removido com sucesso, false caso contrário.
 */
function deleteSavedNumber(id) {
  return new Promise((resolve, reject) => {
    db.run(`DELETE FROM numeros_salvos WHERE id = ?`, [id], function(err) {
      if (err) {
        reject(err);
      } else {
        resolve(this.changes > 0);
      }
    });
  });
}

// =================== EXPORTS ===================

module.exports = {
  db,
  init,
  salvarAtendido,
  removerAtendido,
  buscarAtendido,
  adicionarFila,
  removerFila,
  buscarFila,
  setAtendente,
  getAtendentes,
  getAtendenteDisponivel,
  registrarMensagem,
  registrarEvento,
  salvarAvaliacao,
  registrarInicioAtendimento,
  registrarFimAtendimento,
  buscarCodigoAtendimento,
  gerarCodigoAtendimento,
  agendarTarefa,
  concluirTarefa,
  buscarTarefasPendentes,
  obterHistoricoPorJid,
  obterEstatisticas,
  buscarClientePorAtendente,
  buscarAtendente,
  removerAtendente,
  buscarHistoricoAtendimentoPorId,
  getTotalAtendimentosHoje,
  getAvaliacaoMedia,
  getAtendentesOcupados,
  addSavedNumber,
  getSavedNumbers,
  deleteSavedNumber,
  buscarHistoricoAtendimentoPorCodigo
};