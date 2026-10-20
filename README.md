# WhatsApp Group Bot

Bot de grupos WhatsApp com conexao por codigo de pareamento.

- Numero do bot: `556593511752`
- Dono: `5569993841805`
- Prefixo: `/`

## Como conectar

1. Suba o bot na Square Cloud.
2. Abra os logs da aplicacao.
3. Copie o `CODIGO DE PAREAMENTO`.
4. No WhatsApp do numero `556593511752`:
   - Aparelhos conectados
   - Conectar um aparelho
   - Conectar com numero de telefone
   - Digite o codigo

## Comandos

- `/menu`
- `/ping`
- `/dono`
- `/tagall`
- `/hidetag texto`
- `/ban @pessoa`
- `/promover @pessoa`
- `/rebaixar @pessoa`
- `/sair`
- `/reiniciar`

Somente o dono pode usar os comandos de administracao.

## Square Cloud

Arquivo `squarecloud.app` ja esta pronto.

1. Compacte a pasta do projeto em `.zip`
2. Envie na Square Cloud
3. Abra os logs e use o codigo de pareamento

Nao envie a pasta `auth_info` no zip se quiser forcar um codigo novo.

## GitHub

Este ambiente nao acessa a sua conta GitHub. No seu computador:

```bash
git init
git add .
git commit -m "feat: whatsapp group bot"
git branch -M main
git remote add origin https://github.com/SEU_USUARIO/SEU_REPOSITORIO.git
git push -u origin main
```
