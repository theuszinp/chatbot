# 🤖 ChatBot & Sistema de Gerenciamento de Contas

![GitHub repo size](https://img.shields.io/github/repo-size/theuszinp/chatbot?style=for-the-badge)
![GitHub contributors](https://img.shields.io/github/contributors/theuszinp/chatbot?style=for-the-badge)
![GitHub issues](https://img.shields.io/github/issues/theuszinp/chatbot?style=for-the-badge)
![GitHub license](https://img.shields.io/github/license/theuszinp/chatbot?style=for-the-badge)

✨ **Visão Geral**  
Este é um **aplicativo desktop robusto**, construído com **Electron.js, JavaScript e Node.js**, que otimiza a gestão de contas de comunicação. Ele oferece:

- Gerenciamento de contas  
- Respostas automáticas (Quick Replies)  
- CRM básico  
- Chat automatizado com IA  

Tudo em uma interface **intuitiva, personalizável e moderna**.

![Demo GIF](https://media.giphy.com/media/3o7TKtnuHOHHUjR38Y/giphy.gif)  
*Exemplo de interação com o ChatBot e gerenciamento de contas*

---

## 🚀 Funcionalidades Principais

### 💼 Gerenciamento de Múltiplas Contas
- Adicione, renomeie e remova contas facilmente
- Monitore status (ativo/inativo)
- Notificações de mensagens não lidas

### ⚡ Respostas Rápidas (Quick Replies)
- Crie, edite e envie respostas automáticas para agilizar a comunicação

### 📇 CRM Integrado
- Visualize e organize contatos
- Importe/exporte contatos facilmente
- Integração com WhatsApp

### 🤖 Chat Automatizado com IA
- Envio e recebimento de mensagens de forma interativa
- Avatar personalizado para IA
- Alertas e mensagens de erro

### 🎨 Interface Otimizada
- Modais dinâmicos
- Drag & Drop para reorganização de abas
- Tema claro e escuro

---

## 🛠️ Tecnologias Utilizadas

| Categoria | Tecnologias |
|-----------|------------|
| Frontend  | HTML5, CSS3, JavaScript, Electron.js |
| Backend   | Node.js, IPC do Electron |
| Banco de Dados | SQLite (armazenamento local) |
| Extras    | Sortable.js, APIs do WhatsApp |

![Electron](https://img.shields.io/badge/Electron.js-20232A?style=for-the-badge&logo=electron&logoColor=61DAFB)
![Node.js](https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=node.js&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-07405E?style=for-the-badge&logo=sqlite&logoColor=white)

---

## ⚙️ Como Executar

```bash
# Clone o repositório
git clone https://github.com/theuszinp/chatbot.git
cd chatbot

# Instale dependências
npm install




/project-root
├─ main.js        # Lógica principal do Electron
├─ renderer.js    # Lógica da interface
├─ index.html     # Estrutura principal
├─ style.css      # Estilos da interface
├─ /icons         # Ícones utilizados
└─ /data          # Armazenamento de contatos e quick replies


# Inicie a aplicação
npm start


📂 Estrutura do Projeto
/project-root
├─ main.js        # Lógica principal do Electron
├─ renderer.js    # Lógica da interface
├─ index.html     # Estrutura principal
├─ style.css      # Estilos da interface
├─ /icons         # Ícones utilizados
└─ /data          # Armazenamento de contatos e quick replies

🧠 Aprendizados e Habilidades Desenvolvidas

Gerenciamento de Modais e Eventos: Criação de modais dinâmicos e sistemas de eventos complexos

Comunicação entre Processos (IPC): Integração frontend-backend com Electron

Automação e Integração: Automação de processos e integração com APIs externas

➡️ Roadmap / Próximos Passos

 Suporte para múltiplos usuários simultâneos

 Importação/exportação de contatos em CSV/Excel

 Integração com IA avançada para respostas personalizadas

 Aprimorar UI/UX para experiência mais intuitiva

❤️ Feito com ❤️ por theuszinp


## 🧾 Resumo Profissional do Projeto

Este projeto é uma plataforma de **atendimento digital e operação comercial** orientada a performance.
Na prática, ele centraliza conversas, acompanha filas de atendimento por setor e transforma interações em
indicadores acionáveis para gestão.

### Entregas de valor
- **Operação centralizada**: reúne mensagens, eventos e histórico em um único painel web.
- **Gestão em tempo real**: monitora atendimentos ativos, ocupação de atendentes e status das filas por área.
- **Rastreabilidade completa**: registra jornada do atendimento, com detalhes por interação e linha do tempo.
- **Tomada de decisão baseada em dados**: disponibiliza métricas como volume diário, média de avaliação e pendências.
- **Escalabilidade operacional**: arquitetura em Node.js com persistência local em SQLite, adequada para evoluções incrementais.

### Aplicação prática no negócio
A solução atende contextos em que é necessário combinar **agilidade de resposta**, **controle operacional** e
**visão gerencial**, reduzindo gargalos no atendimento e elevando a qualidade percebida pelo cliente.

