🤖 Sistema de Gerenciamento de Contas e Chat Automatizado

Um aplicativo desktop desenvolvido com Electron.js, JavaScript e Node.js para gerenciar múltiplas contas, respostas automáticas, atalhos de mensagens e contatos. Inclui CRM básico, integração com WhatsApp e chat automatizado com IA.

🔹 Funcionalidades

Gerenciamento de Contas

Adicionar, renomear, remover e alternar entre contas

Monitoramento do status de cada conta (ativo, inativo, carregado, não carregado)

Notificações de mensagens não lidas por conta

Atalhos e Respostas Rápidas (Quick Replies)

Criar, editar e remover atalhos de mensagens

Envio automático de respostas

CRM e Contatos

Visualizar, adicionar, importar e exportar contatos

Integração com WhatsApp para coleta de contatos

Exportação de contatos para arquivos externos

Chat Automatizado com IA

Envio e recebimento de mensagens com interface interativa

Mensagens da IA exibidas com avatar personalizado

Suporte a mensagens de erro e alertas

Interface e Usabilidade

Modais dinâmicos para contas, contatos, quick replies e CRM

Drag & Drop para reorganização das abas de contas

Suporte a tema claro e escuro

🔹 Tecnologias Utilizadas

Frontend / Interface: HTML5, CSS3, JavaScript, Electron.js

Backend / Automação: Node.js, IPC do Electron

Banco de Dados / Armazenamento: JSON local (para contatos e atalhos) Inicialmente, depois implantei o sql lite pra salvar os dados

Extras: Sortable.js (drag & drop das abas), integração com APIs do WhatsApp

🔹 Como Executar

Clone este repositório:

git clone https://github.com/seu-usuario/nome-do-projeto.git


Instale as dependências:

npm install


Execute a aplicação:

npm start


⚠️ Certifique-se de ter Node.js e Electron instalados no seu sistema.

🔹 Estrutura do Projeto
/project-root
├─ main.js           # Código principal do Electron
├─ renderer.js       # Código da interface e lógica do frontend
├─ index.html        # Layout principal da aplicação
├─ style.css         # Estilos da interface
├─ /icons            # Ícones usados na aplicação
└─ /data             # Armazenamento de contatos e quick replies

🔹 Aprendizados e Habilidades

Estruturação de modais dinâmicos e gerenciamento de eventos complexos

Criação de sistemas modulares e reutilizáveis

Experiência prática com IPC no Electron para comunicação entre frontend e backend

Desenvolvimento de interface responsiva para desktop

Automação de processos e integração com serviços externos

🔹 Próximos Passos

Suporte a múltiplos usuários simultâneos

Melhorar exportação/importação de contatos com formatos CSV/Excel

Integração com IA mais avançada para respostas personalizadas

Aprimorar UI/UX para experiência mais intuitiva
