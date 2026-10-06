# Jarvis Móvel 🤖📱

[![Build Mobile APK](https://img.shields.io/github/actions/workflow/status/nicotesterlk22-byte/OpenJarvis/mobile-apk.yml?branch=mobile&label=Build%20Mobile%20APK)](https://github.com/nicotesterlk22-byte/OpenJarvis/actions/workflows/mobile-apk.yml)
[![Latest APK Release](https://img.shields.io/github/v/release/nicotesterlk22-byte/OpenJarvis?filter=*apk*&label=Latest%20APK)](https://github.com/nicotesterlk22-byte/OpenJarvis/releases/tag/latest-apk)
[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)

O **Jarvis Móvel** é uma evolução do ecossistema **OpenJarvis** voltada para dispositivos Android. Ele combina uma interface nativa WebView de altíssimo desempenho (baseada em React, Tailwind CSS e componentes shadcn/ui) com um backend robusto em FastAPI hospedado na nuvem (Railway).

O agente é capaz de interagir por voz em tempo real em português do Brasil, executar scripts Python e comandos de terminal em um ambiente sandbox isolado, navegar na web com transmissão visual ao vivo para o smartphone e adaptar-se perfeitamente ao uso cotidiano.

---

## 🏗️ Arquitetura do Sistema

O Jarvis Móvel segue uma arquitetura descentralizada e segura, onde o aplicativo Android atua como cliente fino e interativo, comunicando-se com o backend via conexões criptografadas (HTTPS e WebSockets).

```text
+-------------------------------------------------------------------------+
|                          APLICATIVO ANDROID                             |
|  [ MainActivity.java (WebView com RECORD_AUDIO, Uploads e Downloads) ]  |
|  [ Frontend React + Vite + Tailwind CSS / shadcn/ui (Mobile-First) ]    |
+-------------------------------------------------------------------------+
                                    |
                            HTTPS / WSS (Auth Token)
                                    v
+-------------------------------------------------------------------------+
|                       BACKEND FASTAPI (RAILWAY)                         |
|                                                                         |
|  +-----------------------+  +----------------------------------------+  |
|  |   Auth Middleware     |  | Subprocess Sandbox (Python/Bash)       |  |
|  |   (Constant-time)     |  | (Timeout 30s, RAM 512MB, Env Clean)    |  |
|  +-----------------------+  +----------------------------------------+  |
|                                                                         |
|  +-----------------------+  +----------------------------------------+  |
|  | Voz em Tempo Real     |  | Visual Ao Vivo (Playwright Browser)    |  |
|  | - STT: faster-whisper |  | - Proteção SSRF anti-loopback/RFC1918  |  |
|  | - TTS: Piper pt-BR    |  | - WebSocket Screenshot Streaming       |  |
|  +-----------------------+  +----------------------------------------+  |
+-------------------------------------------------------------------------+
```

### Componentes Chave:
1. **Cliente Móvel (APK WebView):** Encapsula a interface web moderna, gerenciando permissões nativas de áudio (`RECORD_AUDIO`), seleção de arquivos para upload e downloads.
2. **Sandbox de Comandos:** Executor isolado para tarefas em Python/Bash com restrições rígidas de memória, tempo limite e eliminação de variáveis de ambiente sensíveis.
3. **Engine de Voz:** Suporte offline/neural a fala em Português com **faster-whisper** (reconhecimento de voz STT) e **Piper** (síntese de voz TTS com respostas em streaming).
4. **Visual ao Vivo:** Navegação automatizada controlada via **Playwright**, transmitindo capturas de tela em tempo real via WebSocket para acompanhamento pelo usuário.

---

## 🗺️ Roadmap de Funcionalidades

- [x] **Execução Segura em Sandbox:** Execução de scripts Python e comandos Bash com limites de recurso e timeout de 30s.
- [x] **Voz em Tempo Real (pt-BR):** Transcrição (STT com `faster-whisper`) e síntese vocal neural (TTS com `Piper`).
- [x] **Visual ao Vivo:** Transmissão em tempo real do navegador do agente (Playwright) via WebSocket.
- [x] **Interface Mobile-First:** Design otimizado para celulares com React, shadcn/ui, animações fluidas e tema escuro.
- [x] **Aplicativo Nativo Android:** Wrapper otimizado com suporte a microfone, downloads e uploads.
- [x] **CI/CD Automático:** Workflow do GitHub Actions (`mobile-apk.yml`) para build e publicação automática do APK.
- [x] **Deploy no Railway:** Containerização e infraestrutura prontas para produção no Railway.

---

## 📦 Instruções de Build do APK

### 1. Build Automático via CI (GitHub Actions)
Toda alteração enviada para a branch `mobile` dispara automaticamente o workflow `.github/workflows/mobile-apk.yml`. O workflow compila o projeto Android, assina o aplicativo e atualiza a release [`latest-apk`](https://github.com/nicotesterlk22-byte/OpenJarvis/releases/tag/latest-apk).

### 2. Compilação Local (Gradle)
Para compilar o APK localmente em seu ambiente de desenvolvimento:

**Pré-requisitos:**
* JDK 17 ou superior
* Android SDK e ferramentas de build instaladas

**Passos:**
1. Navegue até o diretório do projeto Android:
   ```bash
   cd mobile
   ```
2. Execute a compilação do APK de release via Gradle Wrapper:
   ```bash
   ./gradlew assembleRelease
   ```
3. O APK gerado estará disponível no caminho:
   ```text
   mobile/app/build/outputs/apk/release/app-release-unsigned.apk
   ```

---

## 🚀 Deploy do Backend no Railway

O backend do Jarvis Móvel é executado em um container Docker dedicado no **Railway**.

### Resumo do Deploy:
1. Conecte o repositório GitHub ao Railway apontando para a branch `mobile`.
2. O Railway utilizará as configurações presentes em `railway.json` e o `deploy/docker/Dockerfile.railway`.
3. Configure as variáveis de ambiente necessárias (como `OPENJARVIS_API_KEY`, provedores de LLM, etc.).

Para o passo a passo completo e detalhado com todas as variáveis e capturas, consulte o guia oficial de deploy:
📄 **[Instruções Detalhadas de Deploy no Railway (docs/DEPLOY_RAILWAY.md)](docs/DEPLOY_RAILWAY.md)**

---

## 🔒 Segurança e Tratamento de Segredos

A segurança é um pilar fundamental no Jarvis Móvel:

* **Zero Segredos no Repositório:** Nenhuma chave de API, token ou credencial é armazenada em código-fonte, commits ou mensagens.
* **Gerenciamento de Segredos:**
  * **GitHub Secrets:** Utilizados exclusivamente para pipelines de CI/CD (ex.: assinaturas de APK e tokens de release).
  * **Railway Environment Variables:** Utilizados para armazenar as chaves de API do backend (`OPENJARVIS_API_KEY`, chaves de LLM, etc.) em runtime seguro.
* **Isolamento de Sandbox:** O executor de comandos sanitiza o ambiente de processos filhos, garantindo que variáveis do processo pai (como tokens de serviço) não fiquem visíveis para os scripts executados.
* **Comparações Seguras:** Autenticação de tokens utilizando comparação de tempo constante (`secrets.compare_digest`) para prevenir ataques de timing.
* **Proteção de Rede (SSRF):** Filtros rígidos no navegador do agente bloqueando acessos a endereços IP privados, RFC1918 e endpoints de metadados de nuvem.

---

## 📄 Licença

Este projeto é distribuído sob a licença [Apache 2.0](LICENSE).
