import type { Message } from "./Message.js";

export interface Channel {
  name: string;
  filter(message: Message): boolean;
}

export function createChannel(
  name: string,
  filterFn: (msg: Message) => boolean,
): Channel {
  return { name, filter: filterFn };
}
