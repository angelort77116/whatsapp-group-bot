const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  Browsers
} = require("@whiskeysockets/baileys");
const pino = require("pino");
const fs = require("fs");
const path = require("path");
const config = require("./config");

const AUTH_DIR = path.join(__dirname, "auth_info");
const logger = pino({ level: "silent" });
let reconnecting = false;

function onlyDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

function jidToNumber(jid) {
  return onlyDigits(String(jid || "").split("@")[0].split(":")[0]);
}

function isOwner(jid) {
  const number = jidToNumber(jid);
  const owner = onlyDigits(config.ownerNumber);
  const ownerNoCountry = owner.startsWith("55") ? owner.slice(2) : owner;
  return (
    number === owner ||
    number === ownerNoCountry ||
    number.endsWith(owner) ||
    number.endsWith(ownerNoCountry)
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseCommand(text) {
  if (!text || !text.startsWith(config.prefix)) return null;
  const withoutPrefix = text.slice(config.prefix.length).trim();
  if (!withoutPrefix) return null;
  const [name, ...rest] = withoutPrefix.split(/\s+/);
  return {
    name: name.toLowerCase(),
    args: rest
  };
}

async function requestPairingCode(sock) {
  const botNumber = onlyDigits(config.botNumber);
  console.log("========================================");
  console.log("Gerando codigo de pareamento...");
  console.log("WhatsApp do numero " + botNumber);
  console.log("Aparelhos conectados > Conectar um aparelho > Conectar com numero de telefone");
  console.log("========================================");

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const code = await sock.requestPairingCode(botNumber);
      const formatted = String(code).match(/.{1,4}/g)?.join("-") || code;
      console.log("");
      console.log("CODIGO DE PAREAMENTO: " + formatted);
      console.log("");
      console.log("Digite esse codigo no WhatsApp. Valido por cerca de 1 minuto.");
      console.log("========================================");
      return formatted;
    } catch (error) {
      console.error("Tentativa " + attempt + " falhou:", error.message);
      await sleep(2000);
    }
  }

  throw new Error("Nao foi possivel gerar o codigo de pareamento");
}

async function sendText(sock, jid, text) {
  await sock.sendMessage(jid, { text });
}

async function handleCommand(sock, msg) {
  const from = msg.key.remoteJid;
  if (!from) return;

  const sender = msg.key.participant || msg.key.remoteJid;
  const body =
    msg.message?.conversation ||
    msg.message?.extendedTextMessage?.text ||
    msg.message?.imageMessage?.caption ||
    "";

  const command = parseCommand(body.trim());
  if (!command) return;

  const isGroup = from.endsWith("@g.us");
  const owner = isOwner(sender) || isOwner(msg.key.remoteJid);

  if (command.name === "ping") {
    await sendText(sock, from, "pong");
    return;
  }

  if (command.name === "menu" || command.name === "help") {
    await sendText(
      sock,
      from,
      [
        "*Bot de Grupos WhatsApp*",
        "",
        "Comandos gerais:",
        "/menu - lista de comandos",
        "/ping - testa se o bot esta online",
        "/dono - mostra o dono",
        "",
        "Comandos do dono:",
        "/reiniciar - reinicia o bot",
        "/sair - sai do grupo atual",
        "/tagall - menciona todos do grupo",
        "/hidetag [texto] - marca todos sem mostrar a lista",
        "/ban @pessoa - remove do grupo",
        "/promover @pessoa - promove a admin",
        "/rebaixar @pessoa - remove admin"
      ].join("\n")
    );
    return;
  }

  if (command.name === "dono") {
    await sendText(sock, from, "Dono autorizado: +" + onlyDigits(config.ownerNumber));
    return;
  }

  if (!owner) {
    if (["reiniciar", "sair", "tagall", "hidetag", "ban", "promover", "rebaixar"].includes(command.name)) {
      await sendText(sock, from, "Apenas o dono pode usar este comando.");
    }
    return;
  }

  if (command.name === "reiniciar") {
    await sendText(sock, from, "Reiniciando...");
    process.exit(0);
  }

  if (!isGroup && ["sair", "tagall", "hidetag", "ban", "promover", "rebaixar"].includes(command.name)) {
    await sendText(sock, from, "Esse comando so funciona em grupos.");
    return;
  }

  if (command.name === "sair") {
    await sendText(sock, from, "Saindo do grupo.");
    await sock.groupLeave(from);
    return;
  }

  if (command.name === "tagall" || command.name === "hidetag") {
    const metadata = await sock.groupMetadata(from);
    const mentions = metadata.participants.map((p) => p.id);
    const text =
      command.name === "hidetag"
        ? command.args.join(" ") || "Atencao"
        : mentions.map((id) => "@" + jidToNumber(id)).join(" ");
    await sock.sendMessage(from, { text, mentions });
    return;
  }

  const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
  const target = mentioned[0];

  if (command.name === "ban") {
    if (!target) {
      await sendText(sock, from, "Marque a pessoa. Exemplo: /ban @pessoa");
      return;
    }
    await sock.groupParticipantsUpdate(from, [target], "remove");
    await sendText(sock, from, "Participante removido.");
    return;
  }

  if (command.name === "promover") {
    if (!target) {
      await sendText(sock, from, "Marque a pessoa. Exemplo: /promover @pessoa");
      return;
    }
    await sock.groupParticipantsUpdate(from, [target], "promote");
    await sendText(sock, from, "Participante promovido a admin.");
    return;
  }

  if (command.name === "rebaixar") {
    if (!target) {
      await sendText(sock, from, "Marque a pessoa. Exemplo: /rebaixar @pessoa");
      return;
    }
    await sock.groupParticipantsUpdate(from, [target], "demote");
    await sendText(sock, from, "Admin rebaixado.");
  }
}

async function restartBot() {
  if (reconnecting) return;
  reconnecting = true;
  await sleep(3000);
  reconnecting = false;
  startBot();
}

async function startBot() {
  if (!fs.existsSync(AUTH_DIR)) {
    fs.mkdirSync(AUTH_DIR, { recursive: true });
  }

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();
  const alreadyRegistered = Boolean(state.creds?.registered);
  let pairingRequested = false;

  const sock = makeWASocket({
    version,
    logger,
    printQRInTerminal: false,
    browser: Browsers.ubuntu("Chrome"),
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger)
    },
    markOnlineOnConnect: false
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect } = update;

    if (!alreadyRegistered && !pairingRequested && (update.qr || connection === "connecting")) {
      pairingRequested = true;
      await sleep(2500);
      try {
        await requestPairingCode(sock);
      } catch (error) {
        console.error("Falha ao gerar codigo de pareamento:", error.message);
        pairingRequested = false;
      }
    }

    if (connection === "open") {
      console.log("Bot conectado no WhatsApp.");
      console.log("Numero do bot: +" + onlyDigits(config.botNumber));
      console.log("Dono: +" + onlyDigits(config.ownerNumber));
    }

    if (connection === "close") {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const loggedOut = statusCode === DisconnectReason.loggedOut;

      console.log("Conexao fechada. Codigo:", statusCode);

      if (loggedOut) {
        console.log("Sessao encerrada. Um novo codigo sera gerado na proxima inicializacao.");
        process.exit(0);
      }

      console.log("Tentando reconectar...");
      restartBot();
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    for (const msg of messages) {
      if (!msg.message || msg.key.fromMe) continue;
      try {
        await handleCommand(sock, msg);
      } catch (error) {
        console.error("Erro ao processar comando:", error.message);
      }
    }
  });

  if (alreadyRegistered) {
    console.log("Sessao encontrada. Conectando...");
  }
}

process.on("uncaughtException", (error) => {
  console.error("Erro nao tratado:", error.message);
});

process.on("unhandledRejection", (error) => {
  console.error("Promise rejeitada:", error?.message || error);
});

startBot();
