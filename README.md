🤖 Sistema de Gerenciamento de Contas e Chat Automatizado

✨ Visão Geral do Projeto
Este é um aplicativo desktop robusto, construído com Electron.js, JavaScript e Node.js, focado em otimizar a gestão de contas de comunicação. Ele oferece um conjunto de funcionalidades poderosas, incluindo gerenciamento de contas, respostas automáticas, um CRM básico e um chat automatizado com IA, tudo em uma interface intuitiva e personalizável.

🚀 Funcionalidades Principais
Gerenciamento de Múltiplas Contas: Adicione, renomeie e remova contas facilmente. Monitore o status (ativo, inativo) e receba notificações de mensagens não lidas.
Atalhos e Respostas Rápidas (Quick Replies): Crie, edite e envie respostas automáticas para agilizar sua comunicação.
CRM Integrado: Mantenha seus contatos organizados. O sistema permite visualizar, importar e exportar contatos, com integração direta para coleta de contatos do WhatsApp.
Chat Automatizado com IA: Envie e receba mensagens de forma interativa. A interface de chat exibe mensagens da IA com um avatar personalizado e inclui suporte para alertas e mensagens de erro.
Interface Otimizada: Desfrute de uma experiência de usuário aprimorada com modais dinâmicos, Drag & Drop para reorganizar abas e suporte para temas claro e escuro.

🛠️ Tecnologias Utilizadas
Categoria	Tecnologias
Frontend	HTML5, CSS3, JavaScript, Electron.js
Backend	Node.js, IPC do Electron
Banco de Dados	SQLite (armazenamento local)
Extras	Sortable.js, integração com APIs do WhatsApp

Exportar para as Planilhas
⚙️ Como Executar
Certifique-se de ter o Node.js e o npm instalados em sua máquina.

Clone o repositório:

Bash

git clone https://github.com/theuszinp/chatbot.git
cd chatbot
Instale as dependências:

Bash

npm install
Inicie a aplicação:

Bash

npm start
📂 Estrutura do Projeto
/project-root
├─ main.js             # Lógica principal do Electron
├─ renderer.js         # Lógica da interface (frontend)
├─ index.html          # Estrutura principal da aplicação
├─ style.css           # Estilos da interface
├─ /icons              # Ícones utilizados
└─ /data               # Armazenamento de contatos e quick replies
🧠 Aprendizados e Habilidades Desenvolvidas
Gerenciamento de Modais e Eventos: Criação de modais dinâmicos e sistemas de eventos complexos.

Comunicação entre Processos (IPC): Experiência prática com a comunicação do Electron para sincronizar o frontend e o backend.

Automação e Integração: Automação de processos e integração com serviços externos via APIs.

➡️ Próximos Passos (Roadmap)
[ ] Implementar suporte para múltiplos usuários simultâneos.
[ ] Melhorar a importação e exportação de contatos para suportar CSV e Excel.
[ ] Integrar com modelos de IA mais avançados para respostas personalizadas.

[ ] Aprimorar a UI/UX para uma experiência ainda mais intuitiva.

<p align="center">Feito com ❤️ por theuszinp</p>
