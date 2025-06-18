const fs = require('fs');
const { Client, GatewayIntentBits, PermissionsBitField, REST, Routes, ActivityType } = require('discord.js');
const axios = require('axios');
const express = require('express');
const app = express();

// Eğer dotenv kullanmak istersen, yorumdaki satırın başındaki // kaldır
// require('dotenv').config();

const config = require('./config.json'); // prefix gibi diğer ayarlar için
const token = process.env.BOT_TOKEN; // Token artık buradan geliyor

if (!token) {
  console.error("HATA: BOT_TOKEN ortam değişkeni ayarlanmamış!");
  process.exit(1);
}

const clientId = '1384850386493636689'; // BOT ID'n
const prefix = config.prefix;
const dataPath = './data.json';

app.get('/', (req, res) => {
  res.send('Bot çalışıyor! 🟢');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Web server ${PORT} portunda çalışıyor.`);
});

let data = { servers: {} };

if (fs.existsSync(dataPath)) {
  try {
    data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  } catch (err) {
    console.error('data.json okunamadı, yeni oluşturuluyor.');
  }
} else {
  fs.writeFileSync(dataPath, JSON.stringify(data, null, 2));
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// Slash Komutu Kurulumu
client.once('ready', async () => {
  console.log(`${client.user.tag} hazır!`);

  const commands = [
    {
      name: 'yardim',
      description: 'Bot komutlarını ve açıklamalarını gösterir'
    }
  ];

  const rest = new REST({ version: '10' }).setToken(token);
  try {
    await rest.put(Routes.applicationCommands(clientId), { body: commands });
    console.log('✅ Slash komutu başarıyla yüklendi!');
  } catch (error) {
    console.error('Slash komut yüklenirken hata:', error);
  }

  // Dinamik "Oynuyor" mesajı
  const statusList = [
    { name: 'b!kur <webhookurl> | b!gonder <mesaj>', type: ActivityType.Playing },
    { name: 'https://discord.gg/GmY4ru7zwA', type: ActivityType.Playing }
  ];

  let i = 0;
  setInterval(() => {
    client.user.setActivity(statusList[i]);
    i = (i + 1) % statusList.length;
  }, 5000);

  // Uptime mesajı
  const uptimeChannelId = '1384876643948171346'; // Kanal ID burada!
  setInterval(() => {
    const guild = client.guilds.cache.find(g => g.channels.cache.has(uptimeChannelId));
    if (!guild) return;
    const channel = guild.channels.cache.get(uptimeChannelId);
    if (!channel) return;
    channel.send('Bot uptime kontrolü: Aktif ve çalışıyor! 🟢').catch(console.error);
  }, 10000); // 10 dakika
});

// Slash Komut İşleme
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'yardim') {
    return interaction.reply({
      content: `**Bot Komutları**:\n\n` +
        `**b!kur <webhookURL>** → Webhook kurulumunu yapar (sadece admin).\n` +
        `**b!gonder <mesaj>** → Mesajınızı admine gönderir.`,
      ephemeral: true
    });
  }
});

function saveData() {
  fs.writeFileSync(dataPath, JSON.stringify(data, null, 2));
}

function resetUserCountIfNeeded(guildId, userId) {
  const now = Date.now();
  if (!data.servers[guildId] || !data.servers[guildId].users[userId]) return;

  const userData = data.servers[guildId].users[userId];
  if (!userData.lastReset || now - userData.lastReset > 24 * 60 * 60 * 1000) {
    userData.count = 0;
    userData.lastReset = now;
    saveData();
  }
}

client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild || !message.content.startsWith(prefix)) return;

  const args = message.content.slice(prefix.length).trim().split(/ +/);
  const command = args.shift().toLowerCase();
  const guildId = message.guild.id;
  const userId = message.author.id;

  if (!data.servers[guildId]) {
    data.servers[guildId] = { webhookURL: null, users: {} };
    saveData();
  }

  if (command === 'kur') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return message.reply('Bu komutu kullanmak için yönetici olmalısınız.');
    }

    const webhookURL = args[0];
    if (!webhookURL || !webhookURL.startsWith('http')) {
      return message.reply('Geçerli bir webhook URL giriniz. Örnek: b!kur https://...');
    }

    data.servers[guildId].webhookURL = webhookURL;
    saveData();

    return message.reply(`Webhook URL başarıyla ayarlandı: ${webhookURL}`);
  }

  if (command === 'gonder') {
    if (!data.servers[guildId].webhookURL) {
      return message.reply('Webhook URL ayarlı değil. Lütfen yönetici `b!kur <url>` komutunu kullanarak kurulum yapsın.');
    }

    if (!data.servers[guildId].users[userId]) {
      data.servers[guildId].users[userId] = { count: 0, lastReset: Date.now() };
      saveData();
    }

    resetUserCountIfNeeded(guildId, userId);

    if (data.servers[guildId].users[userId].count >= 2) {
      return message.reply('Bugün mesaj hakkınızı kullandınız, yarın tekrar deneyin.');
    }

    const content = args.join(' ');
    if (!content) {
      return message.reply('Lütfen mesajınızı yazın. Örnek: `b!gonder Merhaba`');
    }

    const avatarURL = message.author.displayAvatarURL({ format: 'png', dynamic: true, size: 1024 });

    try {
      await axios.post(data.servers[guildId].webhookURL, {
        username: message.author.tag,
        avatar_url: avatarURL,
        content: content
      });

      data.servers[guildId].users[userId].count++;
      saveData();

      return message.reply(`Mesaj gönderildi. Kalan hakkınız: ${2 - data.servers[guildId].users[userId].count}`);
    } catch (error) {
      console.error('Webhook gönderim hatası:', error.message);
      return message.reply('Webhook gönderiminde hata oluştu. Lütfen webhook adresini kontrol edin.');
    }
  }
});

client.login(token);
