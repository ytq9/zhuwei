export { RoomDurableObject } from "../app/_runtime/lib/room/durable-object";

export default {
  fetch() {
    return new Response("Room Durable Object test worker");
  },
} satisfies ExportedHandler<Env>;
