# 🤖 ChupaLink API

**Mandou o link, recebeu o vídeo!**

Bot de WhatsApp (via [Baileys](https://github.com/WhiskeySockets/Baileys) v7) feito em NestJS. Ele fica de olho nos grupos autorizados e, quando alguém manda um link de vídeo do **Instagram** ou do **TikTok**, baixa o vídeo e envia de volta no grupo, respondendo à mensagem original.

Cada link ganha **uma** mensagem de status que o bot vai editando ao vivo, com barra de progresso real do download:

```
🤖 CHUPALINK 🔥 modo turbo ativado
━━━━━━━━━━━━━━━
🎵 TikTok · @usuario

✅ Link farejado
🔄 Puxando o vídeo...
▰▰▰▰▰▱▱▱▱▱ 52%
💾 4,9 MB de 9,5 MB
▫️ Deixando no jeito
▫️ Enviando pro grupo
```

Quando termina, a mesma mensagem vira `✅ missão cumprida! … ⚡ Tudo em 8,2s`, e o vídeo chega respondendo ao link:

```
🍿 Pega a pipoca, chegou o vídeo!

🎵 TikTok · @usuario
📝 Título do vídeo
⏱️ 1:19 · 📐 720p · 💾 9,5 MB

🤖 ChupaLink — mandou o link, recebeu o vídeo!
```

As frases são sorteadas a cada pedido, para o bot não ficar repetitivo. Para mudar a personalidade, edite [bot-messages.ts](src/modules/messages/bot-messages.ts).

> ⚠️ O Baileys não é uma biblioteca oficial: ele se conecta como um "aparelho conectado" do WhatsApp Web. Usar automação pode levar o WhatsApp a restringir o número. Prefira um número dedicado ao bot. Baixe apenas conteúdo que você tem autorização para baixar. O bot **não** contorna DRM, login nem restrições de acesso.

---

## 🚀 Início rápido

Pré-requisitos: Node.js 22, FFmpeg e yt-dlp. Os detalhes estão em [Requisitos](#requisitos).

```bash
git clone https://github.com/leandrosuy2/chupalink.git
cd chupalink
npm install
cp .env.example .env
```

Abra o `.env` e troque o `API_TOKEN` por um valor forte (gere um com `openssl rand -hex 24`). Depois rode:

```bash
npm run start:dev
```

1. Abra `http://localhost:3000/`, digite o `API_TOKEN` e escaneie o QR Code com o WhatsApp do número que vai ser o bot.
2. Adicione esse número a um grupo e autorize o grupo (veja [Configurando os grupos](#configurando-os-grupos)).
3. Mande um link do TikTok ou do Instagram no grupo. 🎬

---

## Plataformas suportadas

| Plataforma | Links aceitos | Observações |
|---|---|---|
| **TikTok** | `tiktok.com/@user/video/ID`, `vm.tiktok.com/XXXX`, `vt.tiktok.com/XXXX`, `tiktok.com/t/XXXX` | Baixa a versão **sem marca d'água** em H.264. Evita H.265, que muitos celulares não reproduzem no WhatsApp. |
| **Instagram** | `/reel/`, `/reels/`, `/p/` (vídeo ou carrossel), `/tv/`, `/share/...` | No carrossel, envia todos os vídeos do post (até `DOWNLOAD_MAX_ITEMS_PER_LINK`). Links `/share/` são resolvidos automaticamente. Posts que exigem login só funcionam com `INSTAGRAM_COOKIES_FILE`. |
| **Link direto** | URL terminando em `.mp4`, `.mov`, `.webm` ou `.m4v` | Download HTTP com proteção contra SSRF. |

Links de outros sites (notícias, YouTube etc.) são ignorados em silêncio, para não poluir o grupo.

Para adicionar uma plataforma, crie um provider que implemente `VideoProvider` (ou estenda `YtdlpProvider`) e inclua-o em `PROVIDER_CLASSES` no arquivo [downloader.module.ts](src/modules/downloader/downloader.module.ts). Nada mais precisa mudar.

---

## Requisitos

- Ubuntu 22.04 ou mais recente (ou qualquer Linux)
- **Node.js 22 LTS**. O Baileys 7 é ESM e é carregado via `require(esm)` (Node ≥ 22.12).
- **FFmpeg e FFprobe**: `sudo apt install ffmpeg`
- **yt-dlp com suporte a impersonation** (necessário para o TikTok):

```bash
sudo apt install python3-pip
```

```bash
pip3 install --user --break-system-packages -U "yt-dlp[default,curl-cffi]"
```

O binário fica em `~/.local/bin/yt-dlp`. Se essa pasta não estiver no `PATH`, aponte `YTDLP_PATH` para ela. Mantenha o yt-dlp atualizado, porque o Instagram e o TikTok mudam com frequência. Para atualizar, rode o mesmo comando `pip3 install -U`.

## Instalação

```bash
npm install
```

```bash
cp .env.example .env
```

Edite o `.env` e defina **pelo menos** um `API_TOKEN` forte. Para gerar um:

```bash
openssl rand -hex 24
```

## Variáveis de ambiente

Todas as variáveis são validadas na inicialização. Se houver erro, a API não sobe e mostra uma mensagem clara.

| Variável | Padrão | Descrição |
|---|---|---|
| `APP_PORT` | `3000` | Porta HTTP |
| `APP_ENV` | `development` | `development` / `production` / `test` |
| `API_TOKEN` | — | **Obrigatória**, com no mínimo 16 caracteres. Use em `Authorization: Bearer <token>` |
| `CORS_ORIGINS` | vazio | Origens permitidas, separadas por vírgula (vazio = nenhuma, `*` = todas) |
| `WHATSAPP_SESSION_NAME` | `chupalink` | Nome da pasta da sessão |
| `WHATSAPP_SESSION_PATH` | `./storage/sessions` | Onde as sessões são salvas. Caminhos relativos partem da raiz do projeto. |
| `WHATSAPP_ALLOWED_GROUPS` | vazio | IDs `...@g.us` separados por vírgula |
| `WHATSAPP_AUTO_CONNECT` | `true` | Conecta automaticamente ao iniciar |
| `WHATSAPP_QR_MAX_CYCLES` | `5` | Ciclos de QR sem leitura antes de pausar |
| `WHATSAPP_VIDEO_MAX_MB` | `100` | Acima disso, o vídeo é enviado como documento |
| `WHATSAPP_DOCUMENT_MAX_MB` | `2000` | Limite absoluto de envio |
| `BOT_PROGRESS_MESSAGES` | `true` | Mensagem de status ao vivo, editada com o progresso. `false` = só envia o vídeo e, em caso de erro, uma mensagem simples |
| `DOWNLOAD_PATH` | `./storage/downloads` | Pasta temporária, limpa após cada envio |
| `DOWNLOAD_MAX_SIZE_MB` | `500` | Tamanho máximo por vídeo |
| `DOWNLOAD_TIMEOUT_SECONDS` | `300` | Tempo máximo de download |
| `DOWNLOAD_CONCURRENCY` | `1` | Quantos downloads rodam ao mesmo tempo |
| `DOWNLOAD_MAX_ATTEMPTS` | `2` | Tentativas para erros recuperáveis (rede, rate-limit) |
| `DOWNLOAD_MAX_ITEMS_PER_LINK` | `10` | Máximo de vídeos por post (carrossel) |
| `VIDEO_TRANSCODE` | `auto` | `auto`: converte para H.264/AAC só se for incompatível. `never`: nunca converte. |
| `YTDLP_PATH` / `FFMPEG_PATH` / `FFPROBE_PATH` | nome do binário | Caminho dos executáveis |
| `INSTAGRAM_COOKIES_FILE` / `TIKTOK_COOKIES_FILE` | vazio | `cookies.txt` (formato Netscape) da **sua** conta, para posts que exigem login |
| `LOG_LEVEL` | `info` | `fatal`, `error`, `warn`, `info`, `debug` ou `trace` |
| `LOG_PATH` | `./storage/logs` | Os logs também são gravados em `chupalink.log` |

## Inicialização

```bash
npm run start:dev
```

`npm run start:dev` sobe em modo desenvolvimento, com reload automático.

```bash
npm run build
```

```bash
npm run start:prod
```

`npm run build` seguido de `npm run start:prod` roda a versão de produção. `npm run start` também funciona e usa `nest start`.

## Conectando o WhatsApp (QR Code)

1. Suba a API. Sem sessão salva, ela gera um QR Code automaticamente.
2. Escaneie o QR Code de uma destas formas:
   - **Painel:** abra `http://localhost:3000/` e informe o `API_TOKEN`. O QR aparece e se atualiza sozinho via Socket.IO, sem precisar recarregar a página.
   - **Terminal:** o QR também é impresso no console/log.
   - **API:** `GET /api/whatsapp/qr` retorna `dataUrl` e `base64`.
3. No celular, vá em **WhatsApp → Configurações → Aparelhos conectados → Conectar um aparelho** e escaneie.
4. O status passa para `CONNECTED` e o painel mostra a conta conectada.

Se ninguém escanear o QR depois de `WHATSAPP_QR_MAX_CYCLES` ciclos, a API para de gerar QR. Use o botão **Conectar** ou chame `POST /api/whatsapp/connect`.

### Estados da conexão

`DISCONNECTED` · `CONNECTING` · `QR_CODE` · `CONNECTED` · `RECONNECTING` · `LOGGED_OUT` · `ERROR`

## Como funciona a persistência da sessão

Você escaneia o QR **uma vez**. Depois disso, as credenciais ficam salvas em disco:

```
storage/sessions/
├── chupalink/              ← permissão 700 (só o usuário do processo lê)
│   ├── creds.json
│   ├── pre-key-*.json
│   ├── session-*.json
│   ├── sender-key-*.json
│   └── app-state-sync-key-*.json
├── chupalink.lock          ← impede duas instâncias na mesma sessão
└── chupalink.groups.json   ← grupos autorizados via API
```

- A persistência usa `useMultiFileAuthState` do Baileys 7. Toda atualização de credencial (`creds.update`) é gravada em `creds.json`, e as chaves são gravadas assim que mudam.
- Ao iniciar, se existe `creds.json` com uma conta pareada, a API **conecta direto, sem QR**. Isso continua valendo depois de reiniciar a API, fechar o terminal, reiniciar o computador, atualizar o código ou reiniciar pelo PM2.
- Quedas temporárias (rede, servidor do WhatsApp) geram reconexão automática com backoff exponencial de até 60 s, **sem tocar nos arquivos**.
- Se o WhatsApp **deslogar** a sessão (por exemplo, você removeu o aparelho no celular), o status vira `LOGGED_OUT` e os arquivos são mantidos. No próximo `connect`, a sessão inválida é **movida** para `storage/sessions/.invalid/` como backup, e um novo QR é gerado.
- `POST /api/whatsapp/disconnect` desconecta **mantendo** a sessão.
- `POST /api/whatsapp/logout` com `{"confirm":"LOGOUT"}` desvincula o aparelho e **apaga** a sessão. É o único caminho que apaga.
- O lock (`chupalink.lock`) contém o PID e o host. Uma segunda instância recusa a sessão em uso. Locks de processos que já morreram são liberados automaticamente.

## Configurando os grupos

O bot **só** atua em grupos autorizados. Mensagens privadas e de outros grupos são ignoradas.

1. Conecte o WhatsApp e adicione o número do bot ao grupo.
2. Descubra o ID do grupo:

```bash
curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/groups
```

3. Autorize o grupo pela API (a configuração fica salva em disco):

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"groupId":"120363000000000000@g.us"}' http://localhost:3000/api/groups/allowed
```

Outra opção é colocar o ID em `WHATSAPP_ALLOWED_GROUPS` no `.env`.

## Como funciona o download

1. A mensagem chega. O bot ignora mensagens dele mesmo, conversas privadas, grupos não autorizados, mensagens com mais de 15 min (acumuladas offline) e mensagens repetidas.
2. Os links são extraídos (mensagens com vários links geram várias tarefas) e a plataforma de cada um é identificada.
3. Uma tarefa entra na **fila** (`PENDING → PROCESSING → DOWNLOADING → SENDING → COMPLETED | FAILED | CANCELLED`). Duplicatas são evitadas: o mesmo vídeo em andamento ou enviado nos últimos 10 min não é baixado de novo.
4. O bot lê os metadados (título, autor, duração, tamanho estimado, thumbnail) e recusa vídeos acima do limite antes de baixar.
5. O vídeo é baixado com `yt-dlp`, executado **sem shell**, com argumentos separados e `--` antes da URL.
6. A integridade é verificada com `ffprobe`. Se o vídeo não estiver em H.264/AAC, é convertido com `ffmpeg`, preservando a qualidade original quando já é compatível.
7. O arquivo é enviado **como vídeo**, respondendo à mensagem original, por streaming do disco (sem carregar tudo na memória). Se passar de `WHATSAPP_VIDEO_MAX_MB`, vai como documento. Se passar do limite absoluto, o grupo é avisado.
8. Os arquivos temporários são apagados.

Erros viram mensagens claras no grupo: link inválido, vídeo indisponível ou removido, conteúdo privado ou que exige login, post sem vídeo, arquivo grande demais, tempo esgotado, download interrompido, falha no envio. Só erros recuperáveis são repetidos. Uma vez iniciado o envio, a tarefa nunca é repetida, para não mandar o mesmo vídeo duas vezes.

### Instagram com login (opcional)

Reels e posts públicos geralmente funcionam sem login. Se aparecer "🔒 Não consegui acessar esse post", o Instagram pode estar exigindo login. Nesse caso:

1. Exporte os cookies da **sua** conta em formato Netscape, por exemplo com uma extensão "Get cookies.txt" no navegador.
2. Salve o arquivo fora do repositório, por exemplo em `storage/cookies/instagram.txt`, com permissão 600.
3. Defina `INSTAGRAM_COOKIES_FILE=./storage/cookies/instagram.txt` e reinicie a API.

## Endpoints

Todos ficam sob `/api` e exigem `Authorization: Bearer <API_TOKEN>` (ou `x-api-token`), exceto `/api/health`. A documentação interativa (Swagger) fica em **`/api/docs`**.

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/health` | Health-check público |
| GET | `/api/whatsapp/status` | Estado da conexão |
| GET | `/api/whatsapp/qr` | QR Code atual (`dataUrl`, `base64`) |
| POST | `/api/whatsapp/connect` | Conecta (sem QR se houver sessão válida) |
| POST | `/api/whatsapp/disconnect` | Desconecta mantendo a sessão |
| POST | `/api/whatsapp/logout` | `{"confirm":"LOGOUT"}`: desloga e apaga a sessão |
| GET | `/api/whatsapp/profile` | Perfil da conta conectada |
| GET | `/api/sessions` | Sessões em disco |
| GET | `/api/sessions/chupalink` | Detalhes da sessão (existe? autenticada? arquivos) |
| GET | `/api/groups` | Grupos da conta (ID, nome, participantes, autorizado?) |
| GET / POST | `/api/groups/allowed` | Lista ou autoriza grupos |
| DELETE | `/api/groups/allowed/:groupId` | Remove um grupo autorizado via API |
| GET | `/api/jobs` | Tarefas e estatísticas da fila (`?status=FAILED&limit=20`) |
| GET | `/api/jobs/:id` | Detalhes de uma tarefa (histórico, erro, arquivos enviados) |
| POST | `/api/jobs` | `{"url","groupId"}`: baixa e envia manualmente para um grupo autorizado |
| POST | `/api/jobs/:id/cancel` | Cancela uma tarefa |
| GET | `/api/downloader/platforms` | Plataformas suportadas |
| POST | `/api/downloader/inspect` | `{"url"}`: metadados de um link, sem baixar |

### Socket.IO

Conecte com `io(url, { auth: { token: API_TOKEN } })`. Eventos emitidos pelo servidor:

`whatsapp.status`, `whatsapp.qr`, `whatsapp.connected`, `whatsapp.disconnected`, `whatsapp.reconnecting`, `whatsapp.logged_out`, `whatsapp.error` e `job.update`.

Ao conectar, o cliente recebe imediatamente o status atual e o QR, se houver.

## Segurança

- Token obrigatório nos endpoints administrativos e no Socket.IO, com comparação em tempo constante.
- Helmet, CORS configurável, rate limit de 120 req/min por IP e validação de entrada com `class-validator` (campos extras são rejeitados).
- Proteção contra SSRF: só IPs públicos, validados também no momento da conexão (contra DNS rebinding). Redirects são revalidados, e localhost, redes privadas, link-local e metadata de cloud são bloqueados.
- Nomes de arquivo sanitizados. Processos externos rodam sem shell.
- Apenas a pasta `public/` é servida por HTTP. `storage/` (sessões, downloads, logs) **nunca** é exposta.
- Credenciais, tokens e QR são removidos dos logs.
- `storage/` e `.env` estão no `.gitignore`. **Nunca** envie a pasta de sessão ao GitHub: quem tem esses arquivos controla o WhatsApp do bot.

## Testes

```bash
npm run test
```

`npm run test` roda os testes unitários e de integração da API (o Baileys é simulado).

```bash
npm run test:network
```

`npm run test:network` faz um teste **real** de ponta a ponta: baixa um TikTok, um Reel e um carrossel do Instagram, verifica H.264/AAC e o envio no grupo (com socket simulado) e confere a limpeza dos arquivos temporários.

Os testes cobrem: inicialização da API, criação da pasta de sessão, recuperação de sessão existente, geração e atualização do QR, reconexão (restartRequired, backoff, loggedOut, limite de QR), lock de instância, identificação de links, validação de URL e SSRF, fila (duplicatas, concorrência, tentativas, cancelamento), processamento de download, envio (vídeo/documento/limite) e tratamento de erros.

## Deploy em VPS (Ubuntu)

```bash
sudo apt update && sudo apt install -y ffmpeg python3-pip git
```

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs
```

```bash
pip3 install --user --break-system-packages -U "yt-dlp[default,curl-cffi]"
```

```bash
git clone <seu-repo> chupalink && cd chupalink && npm ci && npm run build
```

Depois crie o `.env` (com `APP_ENV=production` e `YTDLP_PATH=/home/<usuario>/.local/bin/yt-dlp`). Exponha a API atrás de um proxy reverso (Nginx/Caddy) com HTTPS, ou deixe-a acessível só localmente. O painel e o Socket.IO precisam de suporte a WebSocket no proxy.

### PM2

```bash
sudo npm i -g pm2
```

```bash
pm2 start ecosystem.config.js
```

```bash
pm2 save && pm2 startup
```

O comando `pm2 startup` gera o comando que faz o bot subir junto com o servidor. Para ver os logs (inclusive o QR Code na primeira vez):

```bash
pm2 logs chupalink-api
```

O `ecosystem.config.js` usa **uma única instância** (fork). Não use cluster, porque a sessão do WhatsApp só pode estar aberta em um processo. Ao atualizar o código, rode `git pull && npm ci && npm run build && pm2 restart chupalink-api`. A sessão continua conectada.

### Docker

```bash
mkdir -p storage && sudo chown 1000:1000 storage
```

```bash
docker compose up -d --build
```

A pasta `./storage` é montada como volume, então a sessão sobrevive a rebuilds e à recriação do container. A porta fica restrita a `127.0.0.1`; use um proxy reverso para acesso externo.

## Backup da sessão

Pare o bot antes, para não copiar arquivos no meio de uma escrita:

```bash
pm2 stop chupalink-api && tar czf chupalink-session-$(date +%F).tgz -C storage sessions && pm2 start chupalink-api
```

Para restaurar, extraia o arquivo em `storage/` (resultando em `storage/sessions/chupalink/creds.json`) e inicie o bot. Ele reconecta sem QR. Guarde o backup em local seguro: ele dá acesso ao WhatsApp do bot.

## Estrutura

```
src/
├── main.ts / app.module.ts / app.setup.ts
├── config/                  validação do .env (Joi) e configuração tipada
├── common/                  guard de token, filtro de erros, logger pino, SSRF, links, processos
└── modules/
    ├── whatsapp/            conexão Baileys, QR, reconexão, gateway Socket.IO, endpoints
    ├── sessions/            persistência em disco, lock, backup de sessão inválida
    ├── groups/              grupos disponíveis e autorizados
    ├── downloader/          factory + providers (instagram, tiktok, direct), ffprobe/ffmpeg
    ├── jobs/                fila com concorrência, timeout, tentativas e cancelamento
    ├── messages/            leitura das mensagens e fluxo link → download → envio
    └── health/
```
