/**
 * Command Loader - Separate module to avoid circular dependencies
 */

const fs = require('fs');
const path = require('path');

function registerRegistryCommands(commands, modulePath, label, { noOverwrite = false } = {}) {
  try {
    const list = require(modulePath);
    for (const cmd of list) {
      if (!cmd?.name) continue;
      if (noOverwrite && commands.has(cmd.name)) continue;
      commands.set(cmd.name, cmd);
      cmd.aliases?.forEach((alias) => {
        if (noOverwrite && commands.has(alias)) return;
        commands.set(alias, cmd);
      });
    }
  } catch (error) {
    console.error(`Error loading ${label} commands:`, error.message);
  }
}

function registerFunCommands(commands) {
  // Don't clobber file-based games (coinflip, rps, …)
  registerRegistryCommands(commands, './funCommands', 'fun', { noOverwrite: true });
}

function registerEconomyCommands(commands) {
  registerRegistryCommands(commands, './economyCommands', 'economy', { noOverwrite: true });
}

function registerRpgCommands(commands) {
  registerRegistryCommands(commands, './rpgCommands', 'rpg', { noOverwrite: true });
}

const loadCommands = () => {
  const commands = new Map();
  const commandsPath = path.join(__dirname, '..', 'commands');
  
  if (!fs.existsSync(commandsPath)) {
    console.log('Commands directory not found');
    return commands;
  }
  
  const categories = fs.readdirSync(commandsPath);
  
  categories.forEach(category => {
    const categoryPath = path.join(commandsPath, category);
    if (fs.statSync(categoryPath).isDirectory()) {
      const files = fs.readdirSync(categoryPath).filter(f => f.endsWith('.js'));
      
      files.forEach(file => {
        try {
          const mod = require(path.join(categoryPath, file));
          const list = Array.isArray(mod) ? mod : (mod?.name ? [mod] : []);
          list.forEach((command) => {
            if (!command?.name) return;
            commands.set(command.name, command);
            if (command.aliases) {
              command.aliases.forEach(alias => {
                commands.set(alias, command);
              });
            }
          });
        } catch (error) {
          console.error(`Error loading command ${file}:`, error.message);
        }
      });
    }
  });
  
  registerFunCommands(commands);
  registerEconomyCommands(commands);
  registerRpgCommands(commands);
  return commands;
};

module.exports = { loadCommands, registerFunCommands, registerEconomyCommands, registerRpgCommands };

