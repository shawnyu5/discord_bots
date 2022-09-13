import { Client, Collection, Intents } from "discord.js";
require("dotenv").config();
import fs from "fs";
import { OnStart } from "./deploy-commands";
import config from "../config.json";
import logger from "./logger";
import * as carmen from "./commands/subToCarmen";
import { GatewayIntentBits } from "discord-api-types";
import { join } from "node:path";

declare module "discord.js" {
   export interface Client {
      commands: Collection<unknown, any>;
   }
}

const client = new Client({
   intents: [
      Intents.FLAGS.GUILDS,
      Intents.FLAGS.GUILD_MESSAGES,
      GatewayIntentBits.Guilds,
   ],
});

client.commands = new Collection();

// read all .js command files in the commands folder
const commandFiles = fs
   .readdirSync(__dirname + "/commands")
   .filter((file: string) => file.endsWith(".js"));

// the path to the command folder
const commandsPath = join(__dirname, "commands");
let commands: any = [];

for (const file of commandFiles) {
   const filePath = join(commandsPath, file);
   const command = require(filePath);
   commands.push(command.default.data.toJSON());
}

for (const file of commandFiles) {
   const command = require(`${__dirname}/commands/${file}`);
   // Set a new item in the Collection
   // With the key as the command name and the value as the exported module
   client.commands.set(command.default.data.name, command);
}

let onStart = new OnStart();
client.on("ready", (client: Client) => {
   logger.info(`${client.user?.tag} logged in`);

   client.guilds.cache.forEach(async (guild) => {
      // await onStart.deleteRegisteredCommands(config.clientID, guild); // TODO: fix delete commands. Refer to the discord guide
      // onStart.readAllGuildCommands();
      await onStart.registerCommands(config.clientID, guild, commands);
   });
});

// process.on("SIGINT", () => {
// client.guilds.cache.forEach(async (guild) => {
// try {
// // await onStart.deleteRegisteredCommands(config.clientID, guild);
// } catch (e) {
// logger.error(`No slash command for guild ${guild.name}`);
// // exit process
// process.exit(1);
// }
// });
// });

// process.on("exit", () => {
// client.guilds.cache.forEach(async (guild) => {
// try {
// // await onStart.deleteRegisteredCommands(config.clientID, guild);
// } catch (e) {
// logger.error(`No slash command for guild ${guild.name}`);
// // exit process
// process.exit(1);
// }
// });
// });
// });

client.on("messageCreate", async (message) => {
   await carmen.resetCounter(message);
   // the guild id of the server to keep track of carmen messages
   const carmenGuild = config.carmenRambles.guildID;
   // if message is not sent by carmen, or not in the right guild, ignore it
   if (
      message.author.id != config.carmenRambles.carmenId ||
      message.guildId != carmenGuild
   ) {
      return;
   }

   logger.info("Carmen message: " + message.content);
   const realm = await carmen.getRealm();
   const db: Realm.Results<carmen.IRealm> = realm.objects(
      carmen.dbLabel.dbName
   );

   const messageCreationTime = message.createdAt;
   const previousNotificationTime: Date = new Date(
      db[0].previousNotificationTimeStamp
   );

   // if no previous message, set counter to 0
   if (!previousNotificationTime) {
      realm.write(() => {
         realm.create(carmen.dbLabel.dbName, {
            notificationTimeStamp: messageCreationTime.toString(),
            counter: 0,
         });
      });
      return;
   }

   // calculate the time difference between current carmen message and previous message
   let timeDifference =
      messageCreationTime.getMinutes() - previousNotificationTime.getMinutes();

   // if time difference is within 5 minutes, increment counter
   if (timeDifference < 5) {
      let counter: number = db[0].counter as number;
      realm.write(() => {
         db.update(carmen.dbLabel.counter, counter + 1);
      });
      logger.info(`Counter updated: ${counter + 1}`);
   } else {
      // if time difference is greater than 5 mins, reset counter and last message creation time
      logger.info(`Counter reset. Time difference: ${timeDifference}`);
      carmen.resetDBFields();
      return;
   }

   // update the last message creation time in db
   realm.write(() => {
      db.update(
         carmen.dbLabel.previousNotificationTimeStamp,
         messageCreationTime.toString()
      );
   });

   logger.debug("Counter from db: " + db[0].counter);
   // if counter from db is greater than message limit, send notification
   if (db[0].counter > config.carmenRambles.messageLimit) {
      carmen.sendNotification(message);
      carmen.resetDBFields();
   }
});

client.on("interactionCreate", async (interaction: any) => {
   if (!interaction.isCommand()) return;

   const command = client.commands.get(interaction.commandName);

   if (!command) return;

   try {
      await command.default.execute(interaction);
   } catch (error: any) {
      logger.error(error);
      await interaction.reply({
         content: error.toString(),
         ephemeral: true,
      });
   }
});

client.on("guildCreate", async function (guild) {
   onStart.readAllGuildCommands();
   // onStart.readGlobalCommands();
   await onStart.registerCommands(config.clientID, guild, commands);
});

// client.on("destroy", function (guild: Guild) {
// // onStart.deleteRegisteredCommands(config.clientID, guild);
// });

// process.on("exit", () => {
// onStart.deleteRegisteredCommands(config.clientID);
// });

if (config.development) {
   client.login(config.token_dev);
} else {
   client.login(config.token);
}
