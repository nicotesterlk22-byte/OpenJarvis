# Arquitetura de Segurança e Especificação Técnica — Jarvis Móvel

> **Documento Oficial de Arquitetura do Jarvis Móvel**  
> **Status:** Aprovado / Versão 1.0  
> **Escopo:** Integração Android WebView (APK) + Backend FastAPI (Railway) + Execução Isolada (Sandbox) + Voz (STT/TTS) + Visual ao Vivo (Playwright)

---

## 1. Visão Geral e Princípios "Security First"

O **Jarvis Móvel** é uma evolução do OpenJarvis projetada para execução em dispositivos Android por meio de um wrapper APK nativo rodando a interface web em WebView acoplada a um backend de IA dedicado hospedado no Railway.

### Princípios Invioláveis de Segurança
1. **Zero Segredos em Código / Repositório / Chat:**
   - Nenhuma API key, token de autenticação, senha ou certificado será comitada no Git ou trafegada em mensagens de chat.
   - Toda configuração sensível é fornecida via variáveis de ambiente (`Railway Environment Variables`, `GitHub Secrets`) ou digitada ponta a ponta pelo usuário na UI do aplicativo e armazenada em armazenamento local criptografado/protegido do dispositivo (`SharedPreferences` / `localStorage`).
2. **HTTPS & TLS Obrigatórios:**
   - Comunicação 100% criptografada.
   - O APK rejeita conexões HTTP puras (`android:usesCleartextTraffic="false"`).
   - O WebView redireciona e força `https://` em qualquer endereço informado.
3. **Autenticação e Autorização por Token de Dispositivo:**
   - O backend valida requisições HTTP REST via `Authorization: Bearer <token>` e conexões WebSocket via subprotocolos de autenticação (`openjarvis.auth.v1` + `openjarvis.key.b64url.<token>`).
   - Comparação de tokens realizada em tempo constante (`secrets.compare_digest`) para prevenir ataques de tempo (*timing attacks*).
4. **Isolamento Total de Execução (Sandbox & Sanitização):**
   - Comandos Python/Bash executados pelo agente rodam sob restrições rígidas: usuário sem privilégios, sanitização completa do ambiente (removendo chaves de API e segredos da memória do processo filho), limite de recursos (RAM/CPU/processos via `rlimit`) e timeout estrito (30s).
5. **Proteção contra SSRF e DoS:**
   - O navegador automatizado (Playwright) e chamadas do agente possuem bloqueio contra requisições para IPs internos/privados (`127.0.0.1`, `10.0.0.0/8`, `169.254.169.254`).
   - Rate limiting ativado por token de dispositivo/IP para prevenir abuso e brute-force.

---

## 2. Diagrama da Arquitetura do Sistema

```
+-----------------------------------------------------------------------------------+
|                            DISPOSITIVO MÓVEL (ANDROID)                            |
|                                                                                   |
|   +---------------------------------------------------------------------------+   |
|   |                        APK Native Wrapper (mobile/)                       |   |
|   |  - MainActivity.java (WebChromeClient, PermissionHandler, FileChooser)    |   |
|   |  - SharedPreferences (Guarda 'server_url' e token local)                 |   |
|   +---------------------------------------------------------------------------+   |
|                                         |                                         |
|                                    WebView UI                                     |
|                                         v                                         |
|   +---------------------------------------------------------------------------+   |
|   |                    Frontend (React + Vite + Tailwind/shadcn)              |   |
|   |  - Chat UI, Voice Controls (MediaRecorder/WebAudio), Live Visual Viewer   |   |
|   |  - apiFetch() / WSS Client com Injeção de 'Authorization: Bearer <token>'  |   |
|   +---------------------------------------------------------------------------+   |
+-----------------------------------------------------------------------------------+
                                         |
                            HTTPS / WSS (TLS 1.3)
                                         |
                                         v
+-----------------------------------------------------------------------------------+
|                             RAILWAY / BACKEND CONTAINERS                          |
|                                                                                   |
|   +---------------------------------------------------------------------------+   |
|   |                      FastAPI API Server (porta 8000)                      |   |
|   |  - AuthMiddleware (Bearer Check, Constant-time compare)                   |   |
|   |  - RateLimiter (Sliding Window DoS Protection)                            |   |
|   |  - CORS Policy (OPENJARVIS_CORS_ORIGINS)                                  |   |
|   +---------------------------------------------------------------------------+   |
|                                        |                                          |
|        +-------------------------------+-------------------------------+          |
|        |                               |                               |          |
|        v                               v                               v          |
|  +-------------------+       +-------------------+           +------------------+ |
|  | Sandbox Comandos  |       | Engine Voz STT/TTS|           | Visual Ao Vivo   | |
|  | - Subprocess/     |       | - faster-whisper  |           | - Playwright     | |
|  |   Container       |       | - Piper TTS       |           | - SSRF Filter    | |
|  | - 30s Timeout     |       | - WAV Stream      |           | - WS Screenshot  | |
|  | - Env Sanitized   |       | - Pt-BR Voices    |           |   Stream (JPEG)  | |
|  | - Resource Limits |       +-------------------+           +------------------+ |
|  +-------------------+                                                            |
+-----------------------------------------------------------------------------------+
```

---

## 3. Decisões Arquiteturais Concretas

### A. Comunicação APK WebView (`mobile/`) <-> Backend (`api-server`)
- **APK Layer (`mobile/`):**
  - `MainActivity.java` inicializa o `WebView` configurado com `setJavaScriptEnabled(true)` e `setDomStorageEnabled(true)`.
  - Adiciona suporte ao `WebChromeClient` sobrescrevendo `onPermissionRequest()` para lidar dinamicamente com a concessão da permissão `android.webkit.PermissionRequest.RESOURCE_AUDIO_CAPTURE` (`getUserMedia`).
  - Adiciona `onShowFileChooser()` para permitir upload de arquivos e imagens para a interface do Jarvis.
  - Adiciona `DownloadListener` para permitir o download de arquivos produzidos pelo agente para o armazenamento do celular.
  - Atualiza o `AndroidManifest.xml` solicitando `RECORD_AUDIO`, `INTERNET`, `MODIFY_AUDIO_SETTINGS` e mantendo `android:usesCleartextTraffic="false"`.
- **Backend API Layer (`src/openjarvis/server/app.py`):**
  - Servidor FastAPI expondo endpoints REST e conexões WebSocket.
  - Roteamento CORS configurado via variável `OPENJARVIS_CORS_ORIGINS`, permitindo as origens do WebView e do Railway.

### B. Autenticação por Token de Dispositivo
- **Geração e Distribuição do Token:**
  - O administrador define `OPENJARVIS_API_KEY` nas variáveis de ambiente do Railway (exemplo: `oj_sk_a1b2c3d4...`).
  - Na primeira abertura do aplicativo, a UI do frontend exibe uma tela de pareamento/configurações onde o usuário insere a chave de API.
  - O token é armazenado no `localStorage` sob a chave `openjarvis-settings` -> `apiKey`.
- **Validação de Requisições:**
  - Requisições REST: `frontend/src/lib/api.ts` utiliza `apiFetch()`, injetando automaticamente o cabeçalho `Authorization: Bearer <OPENJARVIS_API_KEY>`.
  - Requisições WebSocket: `AuthMiddleware` e `authenticate_websocket()` validam conexões através das subprotocols `openjarvis.auth.v1` e `openjarvis.key.b64url.<token_b64>`.
  - Adicionado endpoint de verificação `/api/auth/verify` para validar o token no momento da configuração na UI.

### C. Execução Isolada de Comandos Python/Bash (Sandbox)
- **Modo Duplo de Execução (Dual Mode):**
  1. **Modo Subprocesso Isolado (Railway Native / Cloud Container):**
     - Utiliza `src/openjarvis/security/subprocess_sandbox.py` enriquecido.
     - Ambientes como Railway rodam dentro de contêineres e não possuem Docker interno habilitado por padrão.
     - **Segurança Rígida:**
       - **Sanitização de Ambiente:** Variáveis de ambiente sensíveis (`OPENJARVIS_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, etc.) são **expurgadas** do dicionário enviado ao processo filho.
       - **Diretório Temporário:** Cada comando roda em um diretório temporário isolado `/tmp/oj_sandbox_<uuid>` que é destruído após a execução.
       - **Timeout de Execução:** Padrão de 30 segundos com encerramento forçado da árvore de processos (`SIGTERM` seguido de `SIGKILL`).
       - **Limites de Recursos (rlimit):** Aplicação de `resource.setrlimit()` no processo filho para CPU max, Memória RAM max (ex.: 512MB) e número de processos (`RLIMIT_NPROC`).
       - **Truncamento de Output:** Limite máximo de 100 KB de stdout/stderr para evitar estouro de memória.
  2. **Modo Container Docker (`ContainerRunner`):**
     - Ativado quando o runtime Docker/Podman está disponível no host.
     - Roda com `--rm`, `--network none`, `--memory 512m`, `--cpus 1.0`, `--read-only` e usuário não-root.
- **Endpoint e Skill:**
  - Endpoint `/api/sandbox/execute` protegido por autenticação, rate-limiter e auditoria (`audit_logger`).

### D. Voz em Tempo Real (STT + TTS Open Source)
- **Speech-To-Text (STT):**
  - Utiliza `faster-whisper` com modelo pré-treinado otimizado em Português (`whisper-small` ou `whisper-tiny`).
  - Endpoint `POST /api/voice/stt`: Aceita áudio codificado em WebM/WAV/OGG (enviado pelo `MediaRecorder` do WebView), realiza transcrição local rápida e retorna o texto transcrito.
- **Text-To-Speech (TTS):**
  - Utiliza `Piper TTS` (síntese neural ultrarrápida local) com vozes em Português do Brasil (ex.: `pt_BR-faber-medium` ou `pt_BR-edresson-low`).
  - Endpoint `POST /api/voice/tts`: Recebe texto e parâmetros, sintetiza em tempo real e retorna um *stream* de áudio em formato WAV/MP3 (`audio/wav`).
- **Otimização e Gerenciamento de Memória:**
  - Carregamento preguiçoso (*lazy loading*) dos modelos de voz: são inicializados apenas quando o primeiro uso de áudio é requisitado.
  - Dependências agrupadas no extra opcional `voice` em `pyproject.toml`.

### E. Visual ao Vivo (Playwright + WebSocket Screenshots)
- **Navegador Headless e Automação:**
  - O agente utiliza `Playwright` (`async_api`) executando o Chromium em modo *headless*.
  - Cada sessão roda em um contexto limpo e isolado (`browser.new_context()`).
- **Filtro de Segurança SSRF (`src/openjarvis/security/ssrf.py`):**
  - Antes de qualquer navegação (`page.goto`), a URL de destino passa por validação SSRF prevenindo conexões para endereços de rede privada, localhost ou metadados de nuvem (`169.254.169.254`).
- **Streaming de Telas em Tempo Real:**
  - Servidor WebSocket no endpoint `/api/ws/visual/{session_id}`.
  - Quando a automação web está ativa, o agente captura quadros com `page.screenshot(type="jpeg", quality=60)` em taxa de 2 a 5 FPS ou a cada evento DOM (`load`, `click`, `scroll`).
  - Transmite a imagem codificada via WebSocket para o componente React `<VisualStreamViewer />` na UI móvel.

---

## 4. Mapeamento de Arquivos a Criar e Modificar

A tabela abaixo define os arquivos exatos que serão modificados/criados pelas tarefas downstream:

| Tarefa Downstream | Tipo | Arquivo | Descrição da Alteração |
| :--- | :--- | :--- | :--- |
| `comandos_backend` | Modificar | `src/openjarvis/security/subprocess_sandbox.py` | Implementar sanitização total de env vars (remover secrets), aplicação de `rlimit` (memória/CPU) e diretório temporário isolado. |
| `comandos_backend` | Criar | `src/openjarvis/server/sandbox_routes.py` | Endpoint `/api/sandbox/execute` para execução segura de Python/Bash com autenticação e audit log. |
| `comandos_backend` | Modificar | `src/openjarvis/server/app.py` | Incluir o roteador `sandbox_routes` nas rotas da aplicação FastAPI. |
| `voz_backend` | Criar | `src/openjarvis/speech/stt_whisper.py` | Módulo de transcrição de voz usando `faster-whisper` com lazy loading e suporte a pt-BR. |
| `voz_backend` | Criar | `src/openjarvis/speech/tts_piper.py` | Módulo de síntese de voz neural usando `Piper TTS` em Português. |
| `voz_backend` | Criar | `src/openjarvis/server/voice_routes.py` | Endpoints `POST /api/voice/stt` e `POST /api/voice/tts` para áudio multipart e streaming WAV. |
| `voz_backend` | Modificar | `pyproject.toml` | Adicionar dependências no extra `voice` (`faster-whisper`, `piper-tts`, `soundfile`). |
| `visual_ao_vivo` | Criar | `src/openjarvis/tools/browser_visual.py` | Automação Playwright headless com captura de screenshots JPEG e validação SSRF. |
| `visual_ao_vivo` | Criar | `src/openjarvis/server/visual_routes.py` | Endpoint WebSocket `/api/ws/visual/{session_id}` para streaming de capturas do navegador. |
| `visual_ao_vivo` | Criar | `frontend/src/components/Chat/VisualStreamViewer.tsx` | Componente React para exibição em tempo real da tela do agente com indicador de ao vivo. |
| `ui_avancada` | Modificar | `frontend/src/App.tsx` | Melhorias mobile-first, suporte ao modo escuro elegante e navegação responsiva. |
| `ui_avancada` | Modificar | `frontend/src/components/Chat/ChatArea.tsx` | Integração do visualizador ao vivo e controles de gravação/síntese de voz na UI. |
| `ui_avancada` | Modificar | `frontend/src/lib/api.ts` | Garantir injeção de `Authorization: Bearer <token>` em todas as chamadas `apiFetch`. |
| `app_nativo_evolve` | Modificar | `mobile/app/src/main/AndroidManifest.xml` | Permissões `RECORD_AUDIO`, `INTERNET`, `MODIFY_AUDIO_SETTINGS` e bloqueio de cleartext. |
| `app_nativo_evolve` | Modificar | `mobile/app/src/main/java/com/openjarvis/mobile/MainActivity.java` | Suporte a `WebChromeClient.onPermissionRequest` (`getUserMedia`), `onShowFileChooser` e `DownloadListener`. |
| `app_nativo_evolve` | Modificar | `mobile/app/build.gradle` | Incremento de `versionCode` automático e nome da aplicação 'Jarvis'. |
| `deploy_railway_prep` | Criar | `deploy/docker/Dockerfile.railway` | Dockerfile otimizado para o serviço de API server no Railway com dependências de áudio/Playwright. |
| `deploy_railway_prep` | Criar | `railway.json` | Configuração de build e start command (`jarvis serve --host 0.0.0.0 --port 8000`). |
| `readme_personalizado` | Modificar | `README.md` | README personalizado em PT-BR apresentando o Jarvis Móvel, arquitetura, badges e guia de deploy. |

---

## 5. Análise de Riscos e Mitigações

| Risco Identificado | Nível | Causa Raiz | Estratégia de Mitigação |
| :--- | :--- | :--- | :--- |
| **Vazamento de Chaves de API via Comandos em Sandbox** | **CRÍTICO** | O agente executa Python/Bash que pode inspecionar `os.environ` e ler segredos do servidor. | Sanitização estrita em `subprocess_sandbox.py`: exclusão total do dicionário de ambiente das variáveis sensíveis antes de spawnar o processo. |
| **Acesso Indevido a Serviços da Rede Interna via Browser (SSRF)** | **ALTO** | O agente navega para URLs fornecidas pelo usuário ou geradas pela LLM (`http://169.254.169.254`, `http://localhost:8000`). | Interceptador SSRF (`ssrf.py`) em todas as navegações do Playwright, bloqueando IPs de loopback, RFC1918 e metadados de nuvem. |
| **Ataques DoS / Exaustão de Recursos no Railway** | **MÉDIO** | Execução concorrente de múltiplos comandos longos ou síntese contínua de voz. | `RateLimiter` ativo por IP/Token, timeout rígido de 30s em comandos, limite de memória por processo (`rlimit`) e *lazy loading* dos modelos de IA. |
| **Bloqueio de Microfone no WebView Android** | **MÉDIO** | A permissão `RECORD_AUDIO` no Android não é estendida automaticamente ao contexto web do WebView. | Implementação explícita de `WebChromeClient.onPermissionRequest()` em `MainActivity.java` concedendo permissão de captura áudio ao origin da página. |
| **Vazamento de Tokens via Logs de URL em WebSockets** | **MÉDIO** | Envio do token via parâmetro de busca na URL (`?token=...`), que é gravado em logs de acesso HTTP. | Proibição do envio de tokens na URL query string. Obrigatoriedade de envio via cabeçalho HTTP `Authorization` ou subprotocolo de autenticação WebSocket. |

---

## 6. Conclusão

Esta arquitetura garante que o **Jarvis Móvel** entregue uma experiência de assistente pessoal móvel completa (com voz, visual ao vivo e execução de código), mantendo os mais elevados padrões de segurança da informação, isolamento de processos e proteção de credenciais.
