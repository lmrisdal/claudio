import { createInterface } from "node:readline";

const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
const confirmWaiters = new Map();

createInterface({ input: process.stdin }).on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === undefined) {
    confirmWaiters.get(message.id)?.(message.result);
    return;
  }
  const { id, method, params } = message;
  if (method === "hang") return;
  if (method === "echo") send({ id, result: params });
  else if (method === "fail") send({ id, error: "domain failure" });
  else if (method === "emit") {
    send({ event: "install-progress", payload: { gameId: 1 } });
    send({ id, result: null });
  } else if (method === "confirm") {
    send({
      id: "c1",
      request: "confirm",
      params: { title: "T", message: "M", okLabel: "Ok", cancelLabel: "No" },
    });
    new Promise((resolve) => confirmWaiters.set("c1", resolve)).then((answer) =>
      send({ id, result: answer }),
    );
  } else if (method === "garbage") {
    process.stdout.write("not json\n");
    send({ id, result: "after-garbage" });
  } else if (method === "die") process.exit(3);
  else send({ id, error: `Command ${method} not found` });
});
process.stdin.on("end", () => process.exit(0));
