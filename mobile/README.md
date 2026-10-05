# Jarvis Móvel (Android)

App Android nativo (WebView) que abre a interface web do OpenJarvis rodando no seu servidor.

- Na primeira abertura, informa o endereço do servidor (ex.: a URL do deploy no Railway).
- Menu do app: "Trocar servidor" para apontar pra outro endereço sem reinstalar.
- O APK é buildado pelo GitHub Actions (workflow `mobile-apk.yml`) e publicado no release `latest-apk`.

## Build local

```bash
cd mobile
gradle assembleRelease -PserverUrl=https://seu-servidor.up.railway.app
```

Saída: `mobile/app/build/outputs/apk/release/app-release.apk`
