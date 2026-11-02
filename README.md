# Shanex-GOLDEN

## Connection success welcome card

After WhatsApp connects successfully for the first time, the bot sends a welcome card to the linked account's own chat. The image defaults to `utils/bot_image.jpg`.

Open `config.js` and fill in `connectionWelcome.social.youtube`, `connectionWelcome.social.instagram`, and `connectionWelcome.social.github` with your own profile URLs. Each valid URL appears as a link button; an empty value hides that button. Set `connectionWelcome.enabled` to `false` to disable the card.
