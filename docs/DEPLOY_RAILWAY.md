1. Acesse o painel do Railway (https://railway.app) e selecione seu projeto.
2. Clique em "+ New" > "GitHub Repo" e selecione `nicotesterlk22-byte/OpenJarvis`.
3. Escolha a branch `mobile` para implantar este serviço backend separado do Thcode.
4. O Railway usará automaticamente o `railway.json` e o `deploy/docker/Dockerfile.railway`.
5. Vá na aba "Variables" do novo serviço e adicione `OPENJARVIS_API_KEY` com sua chave secreta.
6. Adicione a chave do seu provedor LLM (ex: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` ou `GROQ_API_KEY`).
7. Adicione `OPENJARVIS_CORS_ORIGINS` com `*` ou as origens permitidas da aplicação.
8. Na aba "Settings" > "Networking", clique em "Generate Domain" para criar a URL HTTPS pública.
9. Verifique os logs de Deploy até a confirmação do Healthcheck no endpoint `/health`.
10. Forneça a URL HTTPS gerada (ex: `https://...up.railway.app`) na próxima etapa do Jarvis Móvel.
