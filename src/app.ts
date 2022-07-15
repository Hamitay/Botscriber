import { PrismaClient } from "@prisma/client";
import axios from "axios";
import * as dotenv from "dotenv";
import express from "express";
import { Context, Telegraf } from "telegraf";

const YoutubeNotifier = require("youtube-notification");

dotenv.config();

const { TELEGRAM_TOKEN, HOST } = process.env;

const botRegex = /(_botScriber)|(_bs)\s.*/;
const channelIdRegex = /channel_id=(.)+?(?=")/;

const HELP_TEXT =
  "Those are the commands:\n" +
  "- <b>add</b> <i>[channelUrl]</i>: adds a subscription\n" +
  "- <b>rm</b> <i>[channelUrl]</i>:  removes a subscription\n" +
  "- <b>list</b>: lists all subscriptions\n";

const PORT = 5050;
const baseUrl = `${HOST}:${PORT}`;
const listenerPath = "/youtube/notifications";

const dbClient = new PrismaClient();
const app = express();

const getChannelIdFromPageData = (pageData: string): string | undefined => {
  const match = channelIdRegex.exec(pageData);

  if (match && match.length > 0) {
    return match[0].replace("channel_id=", "");
  }

  return undefined;
};

const getChanneld = async (channelUrl: string) => {
  try {
    const { data } = await axios.get(channelUrl);
    return getChannelIdFromPageData(data);
  } catch (error) {
    console.error(error);
    return undefined;
  }
};

if (TELEGRAM_TOKEN) {
  const bot = new Telegraf(TELEGRAM_TOKEN);

  const notifier = new YoutubeNotifier({
    hubCallback: `${baseUrl}${listenerPath}`,
  });

  app.get("/", (req, res) => {
    res.send("pong");
  });

  app.use(listenerPath, notifier.listener());

  app.listen(PORT, () => {
    console.log("App listening on " + PORT);
  });

  notifier.on("subscribe", (data: any) => {
    console.log("New subscription");
    console.log(data);
  });

  notifier.on("notified", (data: any) => {
    const { link, name } = data.channel;
    const videoLink = data.video.link;
    console.log(`New video by ${name} \n ${videoLink}`);
    notifyOfNewVideo(link, name, videoLink);
  });

  const notifyOfNewVideo = async (
    channelUrl: string,
    channelName: string,
    videoLink: string
  ) => {
    const message = `New video by ${channelName} \n ${videoLink}`;
    const subs = await dbClient.channelSubscription.findMany({
      where: { channelUrl },
    });

    subs.forEach(async (sub) => {
      await bot.telegram.sendMessage(sub.chatId, message);
    });
  };

  const subscribeToChannel = async (channelUrl: string) => {
    if (await subExist(channelUrl)) {
      return;
    }

    const channelId = await getChanneld(channelUrl);

    if (!channelId) {
      throw Error("invalid channel id");
    }

    await notifier.subscribe(channelId);
  };

  const unsubscribeToChannel = async (channelUrl: string) => {
    if (await subExist(channelUrl)) {
      const channelId = await getChanneld(channelUrl);

      if (!channelId) {
        throw Error("invalid channel id");
      }

      await notifier.unsubscribe(channelId);
    }
  };

  const subExist = async (channelUrl: string): Promise<boolean> => {
    const sub = await dbClient.channelSubscription.findFirst({
      where: { channelUrl },
    });

    return sub != null;
  };

  const subExistsOnChat = async (
    chatId: number,
    channelUrl: string
  ): Promise<boolean> => {
    const sub = await dbClient.channelSubscription.findFirst({
      where: { channelUrl, chatId },
    });

    return sub != null;
  };

  const addChannelSubscription = async (ctx: Context, channelUrl: string) => {
    const chatId = ctx.chat?.id;

    if (!chatId) {
      console.error("Invalid chat id");
      return;
    }

    // Checks if sub already exists
    if (await subExistsOnChat(chatId, channelUrl)) {
      ctx.reply("There's already a subscription to this channel");
    }

    try {
      // Subscribe
      await subscribeToChannel(channelUrl);

      await dbClient.channelSubscription.create({
        data: {
          chatId,
          channelUrl,
        },
      });

      ctx.reply("I've added a subscription to: " + channelUrl);
    } catch (error) {
      console.log(error);
      ctx.reply("Error subscribing to that channel");
    }
  };

  const removeChannelSubscription = async (
    ctx: Context,
    channelUrl: string
  ) => {
    const chatId = ctx.chat?.id;
    if (!chatId) {
      console.error("Invalid chat id");
      return;
    }

    try {
      await dbClient.channelSubscription.deleteMany({
        where: { channelUrl, chatId },
      });

      await unsubscribeToChannel(channelUrl);

      ctx.reply("I've deleted the subscription to: " + channelUrl);
    } catch (error) {
      console.error("error");
      ctx.reply("Error unsubscribing to that channel " + channelUrl);
    }
  };

  const listChannelSubscription = async (ctx: Context, _: string) => {
    const chatId = ctx.chat?.id;
    if (!chatId) {
      console.error("Invalid chat id");
      return;
    }

    const subscriptions = await dbClient.channelSubscription.findMany({
      where: { chatId },
    });

    if (!subscriptions || subscriptions.length === 0) {
      ctx.reply("There are no subscriptions yet");
      return;
    }

    const subList = subscriptions
      .map((sub) => `- ${sub.channelUrl}`)
      .join("\n");

    ctx.reply(subList);
  };

  const helpCommand = async (ctx: Context, _: string) => {
    ctx.replyWithHTML(HELP_TEXT);
  };

  const unknownCommand = async (ctx: Context, _: string) => {
    return ctx.reply("Unkonwn command, try typing _bs help");
  };

  const getCommand = (commandDirective: string) => {
    switch (commandDirective) {
      case "add":
        return addChannelSubscription;
      case "rm":
        return removeChannelSubscription;
      case "list":
        return listChannelSubscription;
      case "help":
        return helpCommand;
      default:
        return unknownCommand;
    }
  };

  bot.hears(botRegex, async (ctx) => {
    const args = ctx.message.text.split(" ");

    if (args.length <= 1) {
      console.error("Invalid command");
      return;
    }

    const directive = args[1];
    const command = getCommand(directive);
    await command(ctx, args[2]);
  });

  bot.launch();
  process.once("SIGINT", () => bot.stop("SIGINT"));
  process.once("SIGTERM", () => bot.stop("SIGTERM"));
} else {
  console.error("Missing telegram token");
}
