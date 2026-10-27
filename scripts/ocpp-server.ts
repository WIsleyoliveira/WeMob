import { startOcppServer } from "../src/server/ocpp/ws-server";

const port = Number(process.env.OCPP_PORT ?? 9220);
startOcppServer({ port }).then(({ close }) => {
  const stop = () => void close().then(() => process.exit(0));
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
});
