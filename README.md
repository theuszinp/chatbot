🤖 Sistema de Gerenciamento de Contas e Chat Automatizado
🚀 Visão Geral do Projeto
Este é um aplicativo desktop robusto, desenvolvido com Electron.js, JavaScript e Node.js, projetado para otimizar a gestão de contas de comunicação. Ele oferece um conjunto de funcionalidades poderosas, incluindo gerenciamento de múltiplas contas, respostas automáticas, um CRM básico e um chat automatizado com inteligência artificial, tudo em uma interface intuitiva e personalizável.

✨ Principais Funcionalidades
Gerenciamento de Contas Multiplas: Adicione, renomeie e remova contas facilmente. Monitore o status (ativo, inativo, carregado) e receba notificações de mensagens não lidas.

Atalhos e Respostas Rápidas (Quick Replies): Acelere sua comunicação com atalhos de mensagens personalizáveis. Crie, edite e envie respostas automáticas para agilizar o atendimento.

CRM Integrado: Mantenha seus contatos organizados. O sistema permite visualizar, adicionar, importar e exportar contatos, com integração direta para coleta de contatos do WhatsApp.

Chat Automatizado com IA: Envie e receba mensagens de forma interativa. A interface de chat exibe mensagens da IA com um avatar personalizado e inclui suporte para alertas e mensagens de erro.

Interface Otimizada: Desfrute de uma experiência de usuário aprimorada com modais dinâmicos, funcionalidade de Drag & Drop para reorganizar abas de contas e suporte para temas claro e escuro.

🛠️ Tecnologias Utilizadas
Frontend: HTML5, CSS3, JavaScript e Electron.js.

Backend e Automação: Node.js, com comunicação via IPC do Electron.

Armazenamento de Dados: Inicialmente, os dados eram armazenados em arquivos JSON locais, e o projeto foi aprimorado para usar SQLite para um armazenamento mais eficiente e confiável.

Extras: Sortable.js para o recurso de arrastar e soltar e integração com APIs externas do WhatsApp.

⚙️ Como Executar o Projeto
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
├─ main.js             # Código principal para a lógica do Electron
├─ renderer.js         # Lógica da interface e do frontend
├─ index.html          # Estrutura principal da aplicação
├─ style.css           # Estilos da interface
├─ /icons              # Ícones utilizados
└─ /data               # Armazenamento local de contatos e quick replies
🧠 Aprendizados e Habilidades Desenvolvidas
Gerenciamento de Eventos e Modais: Criação de modais dinâmicos e sistemas de eventos complexos.

Arquitetura Modular: Desenvolvimento de um sistema com módulos reutilizáveis e de fácil manutenção.

Comunicação entre Processos: Experiência prática com a comunicação IPC (Inter-Process Communication) do Electron para sincronizar o frontend e o backend.

Desenvolvimento Desktop: Criação de interfaces responsivas e otimizadas para aplicações desktop.

Automação e Integração: Automação de processos e integração com serviços externos via APIs.

➡️ Próximos Passos (Roadmap)
[ ] Implementar suporte para múltiplos usuários simultâneos.

[ ] Melhorar a importação e exportação de contatos para suportar formatos como CSV e Excel.

[ ] Integrar com modelos de IA mais avançados para respostas ainda mais personalizadas.

[ ] Aprimorar a UI/UX para uma experiência ainda mais intuitiva e agradável.

<p align="center">Feito com ❤️ por theuszinp</p>
