
/**
 * SHANEX GOLDEN MD - Global Configuration
 * Keep credentials in Render environment variables, not public GitHub.
 */
module.exports = {
  // Bot Owner Configuration
  ownerNumber: [process.env.OWNER_NUMBER || '947XXXXXXXX'],
  ownerName: ['SHANUKA UMANGA'],

  // Bot Configuration
  botName: 'SHANEX GOLDEN MD',
  prefix: '.',
  sessionName: 'session',
  sessionID: process.env.SESSION_ID || '',
  newsletterJid: '120363161513685998@newsletter',
  updateZipUrl: 'https://github.com/mruniquehacker/KnightBot-Mini/archive/refs/heads/main.zip',

  // Sticker Configuration
  packname: 'SHANEX GOLDEN MD',

  // Bot Behavior
  selfMode: false,
  autoRead: false,
  autoTyping: false,
  autoBio: false,
  autoSticker: false,
  autoReact: false,
  autoReactMode: 'bot',
  autoDownload: false,

  // Group Settings Defaults
  defaultGroupSettings: {
    antilink: false,
    antilinkAction: 'delete',
    antitag: false,
    antitagAction: 'delete',
    antiall: false,
    antiviewonce: false,
    antibot: false,
    antibotAction: 'warn',
    anticall: false,
    antigroupmention: false,
    antigroupmentionAction: 'delete',
    antigroupstatus: false,
    antigroupstatusAction: 'delete',
    antisticker: false,
    antibadword: false,
    antibadwordAction: 'delete',
    welcome: false,
    welcomeMessage: '╭╼━≪•𝙽𝙴𝚆 𝙼𝙴𝙼𝙱𝙴𝚁•≫━╾╮\n┃𝚆𝙴𝙻𝙲𝙾𝙼𝙴: @user 👋\n┃Member count: #memberCount\n┃𝚃𝙸𝙼𝙴: time⏰\n╰━━━━━━━━━━━━━━━╯\n\n*@user* Welcome to *@group*! 🎉\n*Group 𝙳𝙴𝚂𝙲𝚁𝙸𝙿𝚃𝙸𝙾𝙽*\ngroupDesc\n\n> *ᴘᴏᴡᴇʀᴇᴅ ʙʏ botName*',
    goodbye: false,
    goodbyeMessage: 'Goodbye @user 👋 We will never miss you!',
    antiSpam: false,
    antiSpamAction: 'warn',
    antidelete: false,
    detect: false,
    chatbot: false,
    suppress: false,
    autosticker: false
  },

  // API Keys - configure in Render Environment
  apiKeys: {
    openai: process.env.OPENAI_API_KEY || '',
    deepai: process.env.DEEPAI_API_KEY || '',
    remove_bg: process.env.REMOVE_BG_API_KEY || '',
    telegram: process.env.TELEGRAM_BOT_TOKEN || ''
  },

  // Media APIs
  mediaApiUrl: (process.env.YT_API_URL || 'https://api-xgp2.onrender.com').replace(/\/$/, ''),
  mediaApiKey: process.env.YT_API_KEY || 'knight',
  knightApiUrl: (process.env.KNIGHT_API_URL || 'https://knightbotapi.stream').replace(/\/$/, ''),
  knightApiKey: process.env.KNIGHT_API_KEY || 'knight',
  princeApiUrl: (process.env.PRINCE_API_URL || 'https://api.princetechn.com').replace(/\/$/, ''),
  princeApiKey: process.env.PRINCE_API_KEY || 'prince',

  // Message Configuration
  messages: {
    wait: '⏳ Please wait...',
    success: '✅ Success!',
    error: '❌ Error occurred!',
    ownerOnly: '👑 This command is only for bot owner!',
    adminOnly: '🛡️ This command is only for group admins!',
    groupOnly: '👥 This command can only be used in groups!',
    privateOnly: '💬 This command can only be used in private chat!',
    botAdminNeeded: '🤖 Bot needs to be admin to execute this command!',
    invalidCommand: '❓ Invalid command! Type .menu for help'
  },

  // Sri Lanka Timezone
  timezone: 'Asia/Colombo',

  // Limits
  maxWarnings: 3,

  // Connection Success Welcome Message
  connectionWelcome: {
    enabled: true,

    // Current index.js reads a local image.
    // Upload a real JPEG to utils/bot_image.jpg.
    imagePath: './utils/bot_image.jpg',

    // Bot Banner URL - requires index.js update to use.
    imageUrl: 'https://i.postimg.cc/QdjTFjNm/Shanex-Studio-Cyber-Gold-Banner.png',

    // Add your social links below.
    // Empty links will not show buttons.
    social: {
      youtube: '',   // ADD YOUR YOUTUBE URL HERE
      instagram: '', // ADD YOUR INSTAGRAM URL HERE
      github: ''     // ADD YOUR GITHUB URL HERE
    }
  },

  // Social links for other bot commands
  social: {
    github: '',    // ADD YOUR GITHUB URL HERE
    instagram: '', // ADD YOUR INSTAGRAM URL HERE
    youtube: ''    // ADD YOUR YOUTUBE URL HERE
  }
};
